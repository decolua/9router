"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

/**
 * Zed Connect modal (Codex-style):
 * 1. Auto-import from Zed IDE keyring when a session is detected
 * 2. Browser OAuth (local proxy) with waiting spinner
 * 3. Manual paste of the callback URL
 */
export default function ZedAuthModal({ isOpen, providerInfo, onSuccess, onClose }) {
  const [phase, setPhase] = useState("booting"); // booting | ide-found | browser | importing | success | error
  const [ideSession, setIdeSession] = useState(null);
  const [authData, setAuthData] = useState(null);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const popupRef = useRef(null);
  const flowRef = useRef({ proxyStarted: false, stopSent: false });
  const openedRef = useRef(false);
  const pollAbortRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  const onSuccessRef = useRef(onSuccess);
  const onCloseRef = useRef(onClose);
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    isOpenRef.current = isOpen;
    onSuccessRef.current = onSuccess;
    onCloseRef.current = onClose;
  });

  const stopOwnedProxy = useCallback(() => {
    const flow = flowRef.current;
    if (flow.proxyStarted && !flow.stopSent) {
      flow.stopSent = true;
      fetch("/api/oauth/zed/stop-proxy").catch(() => {});
    }
  }, []);

  const finishSuccess = useCallback(() => {
    setPhase("success");
    onSuccessRef.current?.();
    setTimeout(() => onCloseRef.current?.(), 600);
  }, []);

  const importIdeSession = useCallback(async (session) => {
    if (!session?.accessToken || !session?.userId) return;
    setBusy(true);
    setError(null);
    setPhase("importing");
    try {
      const res = await fetch("/api/oauth/zed/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: session.accessToken,
          userId: session.userId,
          ...(session.systemId ? { systemId: session.systemId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      stopOwnedProxy();
      finishSuccess();
    } catch (err) {
      setError(err.message);
      setPhase("ide-found");
    } finally {
      setBusy(false);
    }
  }, [finishSuccess, stopOwnedProxy]);

  const startBrowserFlow = useCallback(async () => {
    setError(null);
    setAuthData(null);
    setCallbackUrl("");
    flowRef.current = { proxyStarted: false, stopSent: false };
    pollAbortRef.current = false;

    try {
      const startRes = await fetch("/api/oauth/zed/start-proxy");
      const startData = await startRes.json();
      if (!startRes.ok || !startData.success || !startData.callbackUrl) {
        throw new Error(startData.reason || startData.error || "Failed to start Zed callback server");
      }
      flowRef.current.proxyStarted = true;
      flowRef.current.stopSent = false;
      if (!isOpenRef.current) {
        stopOwnedProxy();
        return;
      }

      const authorizeUrl = new URL("/api/oauth/zed/authorize", window.location.origin);
      authorizeUrl.searchParams.set("redirect_uri", startData.callbackUrl);
      const authRes = await fetch(authorizeUrl);
      const nextAuth = await authRes.json();
      if (!authRes.ok) {
        stopOwnedProxy();
        throw new Error(nextAuth.error || "Failed to start Zed authorization");
      }
      if (!isOpenRef.current) {
        stopOwnedProxy();
        return;
      }

      const regBody = { state: nextAuth.state };
      if (nextAuth.codeVerifier) regBody.codeVerifier = nextAuth.codeVerifier;
      if (nextAuth.systemId) regBody.systemId = nextAuth.systemId;
      const regRes = await fetch("/api/oauth/zed/register-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(regBody),
      });
      let regData = null;
      try {
        regData = await regRes.json();
      } catch {
        regData = null;
      }
      if (!regRes.ok || regData?.success === false) {
        stopOwnedProxy();
        throw new Error(regData?.error || "Failed to register Zed login session");
      }
      if (!isOpenRef.current) return;

      setAuthData(nextAuth);
      setPhase((prev) => (prev === "ide-found" || prev === "importing" ? prev : "browser"));
      popupRef.current = window.open(nextAuth.authUrl, "oauth_popup_zed", "width=600,height=700");
    } catch (err) {
      if (!isOpenRef.current) return;
      setError(err.message);
      setPhase((prev) => (prev === "ide-found" ? prev : "browser"));
    }
  }, [stopOwnedProxy]);

  // Open: detect IDE session (auto-import if found), always start browser flow as fallback.
  useEffect(() => {
    if (!isOpen) return;
    if (openedRef.current) return;
    openedRef.current = true;
    setPhase("booting");
    setIdeSession(null);
    setAuthData(null);
    setCallbackUrl("");
    setError(null);
    setBusy(false);
    pollAbortRef.current = false;
    flowRef.current = { proxyStarted: false, stopSent: false };

    let cancelled = false;

    (async () => {
      // Browser flow runs in parallel so paste-callback is always available.
      const browserPromise = startBrowserFlow();

      try {
        const res = await fetch("/api/oauth/zed/auto-import", {
          signal: AbortSignal.timeout(12000),
        });
        const data = await res.json();
        if (cancelled || !isOpenRef.current) return;

        if (data.found && data.accessToken && data.userId) {
          const session = {
            accessToken: data.accessToken,
            userId: String(data.userId),
            systemId: data.systemId || "",
          };
          setIdeSession(session);
          // Auto-import when Zed IDE session is detected.
          await importIdeSession(session);
          return;
        }
      } catch {
        // Fall through to browser UI
      }

      if (cancelled || !isOpenRef.current) return;
      await browserPromise;
      if (!cancelled && isOpenRef.current) setPhase("browser");
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, startBrowserFlow, importIdeSession]);

  // Cleanup on close
  useEffect(() => {
    if (isOpen) return;
    openedRef.current = false;
    pollAbortRef.current = true;
    stopOwnedProxy();
    flowRef.current = { proxyStarted: false, stopSent: false };
    if (popupRef.current && !popupRef.current.closed) {
      try {
        popupRef.current.close();
      } catch {
        // ignore
      }
    }
  }, [isOpen, stopOwnedProxy]);

  // Poll proxy until browser OAuth completes
  useEffect(() => {
    if (!authData?.state) return;
    if (phase === "importing" || phase === "success") return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 200;

    const tick = async () => {
      if (cancelled || pollAbortRef.current || !isOpenRef.current) return;
      attempts += 1;
      try {
        const res = await fetch(
          `/api/oauth/zed/poll-status?state=${encodeURIComponent(authData.state)}`,
        );
        const data = await res.json();
        if (cancelled || pollAbortRef.current) return;
        if (data.status === "done") {
          pollAbortRef.current = true;
          stopOwnedProxy();
          finishSuccess();
          return;
        }
        if (data.status === "error") {
          pollAbortRef.current = true;
          setError(data.error || "Authentication failed");
          setPhase("error");
          return;
        }
      } catch {
        // keep polling
      }
      if (attempts >= MAX_ATTEMPTS) {
        setError("Authentication timeout");
        setPhase("error");
        return;
      }
      setTimeout(tick, 1500);
    };

    setTimeout(tick, 1500);
    return () => {
      cancelled = true;
    };
  }, [authData, phase, finishSuccess, stopOwnedProxy]);

  const handleManualCallback = async () => {
    const input = callbackUrl.trim();
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/zed/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: input,
          state: authData?.state,
          ...(authData?.redirectUri ? { redirectUri: authData.redirectUri } : {}),
          ...(authData?.codeVerifier ? { codeVerifier: authData.codeVerifier } : {}),
          ...(authData?.systemId ? { systemId: authData.systemId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Exchange failed");
      pollAbortRef.current = true;
      stopOwnedProxy();
      finishSuccess();
    } catch (err) {
      setError(err.message);
      setPhase("error");
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    pollAbortRef.current = true;
    stopOwnedProxy();
    onClose();
  };

  const title = `Connect ${providerInfo?.name || "Zed"}`;
  const showBrowserUi = phase === "browser" || phase === "error" || phase === "ide-found";

  return (
    <Modal isOpen={isOpen} title={title} onClose={handleClose} size="lg">
      <div className="flex flex-col gap-4">
        {(phase === "booting" || phase === "importing") && (
          <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg bg-sidebar/50">
            <span className="material-symbols-outlined text-base text-primary animate-spin">
              progress_activity
            </span>
            <span className="text-sm">
              {phase === "importing"
                ? "Importing session from Zed IDE…"
                : "Detecting Zed IDE session…"}
            </span>
          </div>
        )}

        {phase === "ide-found" && ideSession && (
          <div className="space-y-3">
            <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex gap-2">
                <span className="material-symbols-outlined text-green-600 dark:text-green-400">
                  check_circle
                </span>
                <p className="text-sm text-green-800 dark:text-green-200">
                  Zed IDE session detected (user {ideSession.userId}). Import failed — retry or use browser sign-in below.
                </p>
              </div>
            </div>
            <Button onClick={() => importIdeSession(ideSession)} fullWidth disabled={busy}>
              {busy ? "Importing…" : "Import from Zed IDE"}
            </Button>
          </div>
        )}

        {phase === "success" && (
          <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg border border-green-200 dark:border-green-800 text-sm text-green-800 dark:text-green-200">
            Connected successfully.
          </div>
        )}

        {showBrowserUi && (
          <>
            <div className="flex items-center gap-2 px-3 py-2 border border-border rounded-lg bg-sidebar/50">
              <span className="material-symbols-outlined text-base text-primary animate-spin">
                progress_activity
              </span>
              <span className="text-sm">Waiting for popup authorization…</span>
            </div>

            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-text-muted uppercase tracking-wider">
                Or paste callback URL manually
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium mb-2">Step 1: Open this URL in your browser</p>
                <div className="flex gap-2">
                  <Input
                    value={authData?.authUrl || ""}
                    readOnly
                    className="flex-1 font-mono text-xs"
                  />
                  <Button
                    variant="secondary"
                    icon={copied === "auth_url" ? "check" : "content_copy"}
                    onClick={() => copy(authData?.authUrl, "auth_url")}
                    disabled={!authData?.authUrl}
                  >
                    Copy
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Step 2: Paste the callback URL here</p>
                <p className="text-xs text-text-muted mb-2">
                  After authorization, copy the full URL from your browser (or the local callback page).
                </p>
                <Input
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  placeholder="http://127.0.0.1:.../?user_id=...&access_token=..."
                  className="font-mono text-xs"
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleManualCallback}
                fullWidth
                disabled={busy || !callbackUrl.trim() || !authData}
              >
                {busy ? "Connecting…" : "Connect"}
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

ZedAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerInfo: PropTypes.object,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
