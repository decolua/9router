"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

/**
 * Kiro hosted SSO form (External IdP / Microsoft Entra ID).
 *
 * Two-leg flow:
 *   1. Portal descriptor → discover Microsoft endpoints → open Microsoft sign-in
 *   2. Microsoft callback (with code) → exchange for tokens → save connection
 *
 * The loopback listener on `localhost:3128` captures redirects automatically when
 * the browser can reach the 9router host. When it cannot (VPS deployment, blocked
 * port, remote browser), the user pastes the callback URL here. The paste path
 * uses the sessionId in the request body as the CSRF anchor instead of the URL
 * state, so Microsoft/Kiro-issued state values still match the session.
 */
export default function ExternalIdpAuthForm({ isOpen, onSuccess, onClose }) {
  const [step, setStep] = useState("input"); // input | waiting | success | error
  const [region, setRegion] = useState("us-east-1");
  const [signInUrl, setSignInUrl] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [manualCallbackUrl, setManualCallbackUrl] = useState("");
  const [error, setError] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmittingCallback, setIsSubmittingCallback] = useState(false);
  const pollRef = useRef(null);
  const activeSessionRef = useRef("");
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    if (!isOpen) {
      resetState();
    }
    return () => {
      if (!isOpen) cancelActiveSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function resetState() {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    setStep("input");
    setSignInUrl("");
    setSessionId("");
    setManualCallbackUrl("");
    setError(null);
    setIsStarting(false);
    setIsSubmittingCallback(false);
    activeSessionRef.current = "";
  }

  async function cancelActiveSession() {
    const id = activeSessionRef.current;
    if (!id) return;
    activeSessionRef.current = "";
    try {
      await fetch("/api/oauth/kiro/external-idp/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: id }),
      });
    } catch {
      // Best-effort cleanup only.
    }
  }

  async function startSignIn() {
    setIsStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/oauth/kiro/external-idp/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ region: region || "us-east-1" }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to start sign-in (${res.status})`);
      }

      setSessionId(data.sessionId);
      setSignInUrl(data.signInUrl);
      activeSessionRef.current = data.sessionId;
      setStep("waiting");

      window.open(data.signInUrl, "_blank");
      poll(data.sessionId, data.interval || 2);
    } catch (err) {
      setError(err.message || "Failed to start Kiro sign-in");
      setStep("error");
    } finally {
      setIsStarting(false);
    }
  }

  function poll(id, intervalSeconds) {
    pollRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/oauth/kiro/external-idp/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: id }),
        });
        const data = await res.json();
        if (data.completed) {
          activeSessionRef.current = "";
          setStep("success");
          onSuccess?.(data.connection);
          return;
        }
        if (res.ok && data.success && !data.completed) {
          poll(id, intervalSeconds);
          return;
        }
        throw new Error(data.error || "Kiro sign-in failed");
      } catch (err) {
        await cancelActiveSession();
        setError(err.message || "Kiro sign-in failed");
        setStep("error");
      }
    }, Math.max(1, intervalSeconds) * 1000);
  }

  async function submitManualCallback() {
    if (!sessionId || !manualCallbackUrl.trim()) return;
    setError(null);
    setIsSubmittingCallback(true);
    try {
      const res = await fetch("/api/oauth/kiro/external-idp/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          callbackUrl: manualCallbackUrl.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Callback submit failed (${res.status})`);
      }

      if (data.nextUrl) {
        setSignInUrl(data.nextUrl);
        window.open(data.nextUrl, "_blank");
        setManualCallbackUrl("");
        setError("Continue in the Microsoft sign-in tab. Paste the next callback URL here when it returns.");
        return;
      }
      if (data.status === "captured") {
        setManualCallbackUrl("");
        setError("Callback captured. Finishing connection…");
        return;
      }
      if (data.status === "ignored") {
        setError("That callback URL did not match this sign-in session. Paste the latest URL from the sign-in tab.");
        return;
      }
    } catch (err) {
      setError(err.message || "Failed to submit callback URL");
    } finally {
      setIsSubmittingCallback(false);
    }
  }

  async function handleClose() {
    await cancelActiveSession();
    onClose?.();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Connect Kiro External IdP" size="lg">
      <div className="flex flex-col gap-5">
        {step === "input" && (
          <>
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex gap-2">
                <span className="material-symbols-outlined text-blue-600 dark:text-blue-400">info</span>
                <div className="flex-1 text-sm text-blue-800 dark:text-blue-200">
                  <p className="font-medium mb-1">Sign in through Kiro&apos;s hosted portal</p>
                  <p>
                    Opens Kiro at <span className="font-mono">app.kiro.dev/signin</span>. Use your Microsoft Entra ID
                    (Azure AD) account there. The callback will return to 9router automatically.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">AWS Region</label>
              <Input
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="us-east-1"
                className="font-mono text-sm"
              />
              <p className="text-xs text-text-muted mt-1">
                Defaults to us-east-1. Azure tenant accounts can auto-resolve their profile region later.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={startSignIn} fullWidth disabled={isStarting || !region.trim()}>
                {isStarting ? "Starting..." : "Open Kiro sign-in"}
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}

        {step === "waiting" && (
          <>
            {/* Top status pill */}
            <div className="flex items-center justify-center gap-3 py-4 px-5 rounded-xl border border-border bg-surface-2">
              <span className="material-symbols-outlined text-2xl text-primary animate-spin">progress_activity</span>
              <p className="text-sm text-text-main">Waiting for Kiro sign-in callback…</p>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3 select-none" aria-hidden="true">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs font-medium tracking-wider text-text-muted uppercase">
                Or paste callback URL manually
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Step 1 */}
            <div>
              <p className="text-sm font-medium mb-2">
                <span className="text-text-muted">Step 1:</span> Open this URL in your browser
              </p>
              <div className="flex gap-2">
                <Input value={signInUrl} readOnly className="flex-1 font-mono text-xs" />
                <Button
                  variant="secondary"
                  size="md"
                  icon={copied === "sign_in_url" ? "check" : "content_copy"}
                  onClick={() => copy(signInUrl, "sign_in_url")}
                  className="shrink-0"
                >
                  Copy
                </Button>
              </div>
            </div>

            {/* Step 2 */}
            <div>
              <p className="text-sm font-medium mb-2">
                <span className="text-text-muted">Step 2:</span> Paste the callback URL here
              </p>
              <p className="text-xs text-text-muted mb-2">
                After sign-in, copy the full URL from your browser&apos;s address bar.
              </p>
              <Input
                value={manualCallbackUrl}
                onChange={(e) => setManualCallbackUrl(e.target.value)}
                placeholder="http://localhost:3128/?code=... or http://localhost:3128/oauth/callback?code=..."
                maxLength={4096}
                className="font-mono text-xs"
                inputClassName="font-mono text-xs"
              />
            </div>

            {error && (
              <div className={`p-3 rounded-lg border ${
                error.includes("Continue in the Microsoft sign-in tab")
                  ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
                  : error.includes("captured")
                    ? "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800"
                    : "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800"
              }`}>
                <p className={`text-sm ${
                  error.includes("captured")
                    ? "text-blue-700 dark:text-blue-300"
                    : "text-amber-700 dark:text-amber-300"
                }`}>{error}</p>
              </div>
            )}

            {sessionId && (
              <p className="text-xs text-text-muted text-center">Session: {sessionId.slice(0, 12)}…</p>
            )}

            {/* Footer actions */}
            <div className="flex gap-2 pt-2">
              <Button
                onClick={submitManualCallback}
                fullWidth
                disabled={!manualCallbackUrl.trim() || isSubmittingCallback}
                loading={isSubmittingCallback}
              >
                Connect
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}

        {step === "success" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-green-600">check_circle</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connected Successfully!</h3>
            <p className="text-sm text-text-muted mb-4">Your Kiro SSO account has been connected.</p>
            <Button onClick={onClose} fullWidth>Done</Button>
          </div>
        )}

        {step === "error" && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-red-600">error</span>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connection Failed</h3>
            <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
            <div className="flex gap-2">
              <Button onClick={() => setStep("input")} variant="secondary" fullWidth>
                Try Again
              </Button>
              <Button onClick={handleClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

ExternalIdpAuthForm.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
