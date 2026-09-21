"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal } from "./index";

const AUTH_BASE = "https://www.orcarouter.ai";

/**
 * OrcaRouter connect modal — the two ways to connect are shown side by side:
 *
 *  - **API key**: paste an existing `sk-orca-…` key.
 *  - **Sign in**: OAuth 2.0 + PKCE, out-of-band code (`callback_url=oob`).
 *    9Router is self-hosted, so its address and port differ per deployment and a
 *    loopback redirect is not reliably reachable; the code is shown on the
 *    consent screen and pasted back here. S256 is always used.
 *
 * The login lock (busy/hint) is released on every terminal path: success,
 * denial, exchange error, timeout, explicit cancel, closing the modal, unmount,
 * reload/window close (`pagehide`). A monotonic generation guards against a late
 * response from an aborted attempt overwriting a newer one.
 */
export default function OrcaRouterAuthModal({ isOpen, providerInfo, onSuccess, onClose }) {
  const [tab, setTab] = useState("oauth");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [authorizeUrl, setAuthorizeUrl] = useState(null);
  const [hint, setHint] = useState(null);
  const [code, setCode] = useState("");
  const [done, setDone] = useState(false);
  // Non-secret summary of an already-saved key: `GET /api/providers` strips the
  // credential, so the browser can only ever show a redacted handle, never the
  // key itself. `keyHint` is derived server-side from the secret's own shape.
  const [storedKey, setStoredKey] = useState(null);

  // Attempt generation + in-flight request state. `attemptRef` increments on
  // every start; every async continuation confirms it still owns the current
  // generation before touching state or credentials.
  const attemptRef = useRef(0);
  const authDataRef = useRef(null);
  const abortRef = useRef(null);
  // The synchronous pagehide path must never write React state during unmount,
  // so it reads these flags instead of the state values.
  const busyRef = useRef(false);
  const cancelledRef = useRef(false);

  const generation = () => attemptRef.current;

  const releaseLoginLock = useCallback(() => {
    busyRef.current = false;
    abortRef.current?.abort?.();
    abortRef.current = null;
    setBusy(false);
    setHint(null);
  }, []);

  // Invalidate the current attempt and release the server-side work. Called for
  // cancel, close, tab switch and unmount.
  const cancelAttempt = useCallback(({ keepGeneration = false } = {}) => {
    if (!keepGeneration) attemptRef.current += 1;
    releaseLoginLock();
    setAuthorizeUrl(null);
    setCode("");
  }, [releaseLoginLock]);

  // Load the redacted status of any already-saved OrcaRouter key when the modal
  // opens. This only ever reads non-secret fields (`keyHint`, `createdAt`).
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/providers");
        if (!res.ok) return;
        const data = await res.json();
        const conn = (data.connections || []).find((c) => c.provider === "orcarouter" && c.keyHint);
        if (!cancelled) setStoredKey(conn ? { keyHint: conn.keyHint, name: conn.name, createdAt: conn.createdAt } : null);
      } catch {
        if (!cancelled) setStoredKey(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, done]);

  // `pagehide` needs its own handler: the browser may restore this page from the
  // back-forward cache, so the guarded `finally` blocks correctly refuse to
  // mutate state and would leave the restored page permanently busy. Clear the
  // lock synchronously here. `cancelledRef` tells an in-flight `finally` not to
  // re-arm UI state on a live (bfcache-restored) page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPageHide = () => {
      if (!busyRef.current) return;
      cancelledRef.current = true;
      attemptRef.current += 1;
      busyRef.current = false;
      abortRef.current?.abort?.();
      abortRef.current = null;
      setBusy(false);
      setHint(null);
      setAuthorizeUrl(null);
    };
    window.addEventListener("pagehide", onPageHide);
    // A restored-from-bfcache page fires `pageshow`; let a new attempt start.
    const onPageShow = () => { cancelledRef.current = false; };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  // Unmount / close: cancel server work without writing state.
  useEffect(() => {
    if (isOpen) return undefined;
    attemptRef.current += 1;
    busyRef.current = false;
    cancelledRef.current = true;
    abortRef.current?.abort?.();
    abortRef.current = null;
    // Deferred on purpose: a synchronous setState in an effect body schedules a
    // cascading render. The cleanup flag drops this reset if the modal reopens
    // before the microtask runs, so a reopen never inherits the closed state.
    let reopened = false;
    queueMicrotask(() => {
      if (reopened) return;
      setBusy(false);
      setError(null);
      setHint(null);
      setAuthorizeUrl(null);
      setCode("");
      setDone(false);
    });
    return () => { reopened = true; };
  }, [isOpen]);

  const startOAuth = useCallback(async () => {
    // Every attempt gets a fresh generation, a fresh PKCE verifier and a fresh
    // state value — the server generates both per authorize call.
    const attempt = generation() + 1;
    attemptRef.current = attempt;
    cancelledRef.current = false;
    setError(null);
    setHint(null);
    setDone(false);
    setBusy(true);
    busyRef.current = true;

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/oauth/orcarouter/authorize`, {
        signal: controller?.signal,
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (attemptRef.current !== attempt || cancelledRef.current) return;
      if (!res.ok || !data.authUrl) {
        throw new Error(data.error || "Failed to start the OrcaRouter sign-in");
      }
      authDataRef.current = data;
      setAuthorizeUrl(data.authUrl);
      setHint("Open the link, approve access, then paste the code shown on the page.");
    } catch (err) {
      if (attemptRef.current !== attempt || cancelledRef.current) return;
      if (err?.name === "AbortError") return;
      setError(err.message);
    } finally {
      // A pagehide/unmount that already cleared the lock must not re-arm it.
      if (attemptRef.current === attempt && !cancelledRef.current) {
        setBusy(false);
        busyRef.current = false;
      }
    }
  }, []);

  const submitCode = useCallback(async (event) => {
    event?.preventDefault?.();
    const authData = authDataRef.current;
    const attempt = generation() + 1;
    attemptRef.current = attempt;
    setError(null);

    if (!authData) {
      setError("Start the sign-in first, then paste the code.");
      return;
    }
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Paste the code shown on the OrcaRouter page.");
      return;
    }

    setBusy(true);
    busyRef.current = true;
    try {
      const res = await fetch(`/api/oauth/orcarouter/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: trimmed,
          redirectUri: authData.redirectUri,
          codeVerifier: authData.codeVerifier,
          state: authData.state,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (attemptRef.current !== attempt || cancelledRef.current) return;
      if (!res.ok || !data.success) {
        throw new Error(data.error || "OrcaRouter did not accept that code");
      }
      // Terminal success releases the whole lock.
      attemptRef.current += 1;
      releaseLoginLock();
      setCode("");
      setAuthorizeUrl(null);
      setHint(null);
      setDone(true);
      onSuccess?.();
    } catch (err) {
      if (attemptRef.current !== attempt || cancelledRef.current) return;
      // A rejected/expired/reused code is not recoverable in place: clear the
      // attempt so the user can start a clean one.
      setError(err.message);
      setAuthorizeUrl(null);
      authDataRef.current = null;
    } finally {
      if (attemptRef.current === attempt && !cancelledRef.current) {
        setBusy(false);
        busyRef.current = false;
      }
    }
  }, [code, onSuccess, releaseLoginLock]);

  const submitApiKey = useCallback(async (event) => {
    event?.preventDefault?.();
    const trimmed = apiKey.trim();
    setError(null);
    if (!trimmed) {
      setError("Enter your OrcaRouter API key.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/providers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "orcarouter", apiKey: trimmed, name: "OrcaRouter API Key" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not save the OrcaRouter API key");
      // Success is the only place the secret leaves memory; it is never stored
      // in component state beyond this input.
      setApiKey("");
      setDone(true);
      onSuccess?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }, [apiKey, onSuccess]);

  const handleClose = useCallback(() => {
    cancelAttempt();
    onClose?.();
  }, [cancelAttempt, onClose]);

  const switchTab = useCallback((next) => {
    // Switching auth method cancels the in-flight attempt instead of leaving it
    // running and then surfacing under the other tab.
    cancelAttempt();
    setError(null);
    setDone(false);
    setTab(next);
  }, [cancelAttempt]);

  // Redacted handle for a stored key. `keyHint` is computed server-side from the
  // secret's own shape; the browser never receives the credential, so this is the
  // only representation of a saved key that may be rendered.
  const maskedKey = storedKey?.keyHint || "";

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Connect ${providerInfo?.name || "OrcaRouter"}`}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          Two ways to connect: sign in with your OrcaRouter account, or paste an existing API key. Both end up as a
          normal OrcaRouter key billed to your own account.
        </p>

        <div className="flex gap-2" role="tablist" aria-label="OrcaRouter authentication method">
          <Button
            size="sm"
            variant={tab === "oauth" ? "primary" : "secondary"}
            onClick={() => switchTab("oauth")}
            aria-selected={tab === "oauth"}
            data-testid="orca-tab-auth"
          >
            OrcaRouter - Auth
          </Button>
          <Button
            size="sm"
            variant={tab === "apikey" ? "primary" : "secondary"}
            onClick={() => switchTab("apikey")}
            aria-selected={tab === "apikey"}
            data-testid="orca-tab-api"
          >
            OrcaRouter - API
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-xs text-red-500">
            {error}
          </p>
        )}

        {done && !error && (
          <p className="text-xs text-green-500">Connected. You can close this window.</p>
        )}

        {tab === "apikey" ? (
          <form className="flex flex-col gap-3" onSubmit={submitApiKey}>
            <Input
              label="OrcaRouter API key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-orca-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={busy}
              data-testid="orca-api-key-input"
            />
            {maskedKey && (
              <div className="flex flex-col gap-1" data-testid="orca-stored-key">
                <p className="text-xs text-text-muted" data-testid="orca-api-key-masked">
                  Stored key: <span className="font-mono">{maskedKey}</span>
                </p>
                <p className="text-xs text-text-muted">
                  Saving a new key replaces it. Remove it from the connection list to revoke this installation.
                </p>
              </div>
            )}
            <p className="text-xs text-text-muted">
              Create or revoke keys in the{" "}
              <a href={`${AUTH_BASE}/console/authorized-apps`} target="_blank" rel="noreferrer" className="underline">
                OrcaRouter console
              </a>
              .
            </p>
            <Button type="submit" size="sm" disabled={busy} icon="key">
              {busy ? "Saving…" : "Save API key"}
            </Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <Button size="sm" icon="lock" onClick={startOAuth} disabled={busy}>
              {busy ? "Waiting…" : authorizeUrl ? "Restart sign-in" : "Sign in with OrcaRouter"}
            </Button>

            {authorizeUrl && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-text-muted">{hint}</p>
                <a
                  href={authorizeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs break-all underline"
                  data-testid="orca-authorize-url"
                >
                  {authorizeUrl}
                </a>
                <form className="flex flex-col gap-2" onSubmit={submitCode}>
                  <Input
                    label="Authorization code"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Paste the code from the OrcaRouter page"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    disabled={busy}
                    data-testid="orca-code-input"
                  />
                  <Button type="submit" size="sm" disabled={busy} data-testid="orca-connect-submit">
                    Connect
                  </Button>
                </form>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={handleClose}>
            {busy ? "Cancel" : "Close"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

OrcaRouterAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerInfo: PropTypes.shape({ name: PropTypes.string }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
