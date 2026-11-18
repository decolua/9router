"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import RemoteLoginBrowser from "./RemoteLoginBrowser";
import BrowserProfilePicker from "./BrowserProfilePicker";

// Client mirror of open-sse/services/webLoginConfig.js keys — the server list
// stays authoritative (POST rejects anything not configured there).
export const WEB_LOGIN_PROVIDERS = new Set([
  "grok-web",
  "chatgpt-web",
  "gemini-web",
  "muse-web",
  "deepseek-web",
  "uc-web",
]);

/**
 * Login with a persistent shared browser profile in an embedded secure viewer.
 * Polls credential capture and auto-creates the connection; cookies never reach
 * this component.
 */
export default function WebLoginButton({ providerId, onConnected, size = "sm" }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | opening | waiting | success | error
  const [message, setMessage] = useState("");
  const [profile, setProfile] = useState("default");
  const [profileAvailable, setProfileAvailable] = useState(false);
  const [viewer, setViewer] = useState(null);
  const runRef = useRef(0);
  const timerRef = useRef(null);
  const closeTimerRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    runRef.current += 1;
    stopPolling();
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, [stopPolling]);

  useEffect(() => {
    if (!open) return;
    try { setProfile(window.localStorage.getItem(`weblogin:profile:${providerId}`) || "default"); } catch { setProfile("default"); }
  }, [open, providerId]);

  const pickProfile = useCallback((value) => {
    setProfile(value);
    try { window.localStorage.setItem(`weblogin:profile:${providerId}`, value); } catch { /* Profile selection remains usable without storage. */ }
  }, [providerId]);

  const busy = phase === "opening" || phase === "waiting";

  const handleClose = useCallback(() => {
    if (busy) return;
    stopPolling();
    setOpen(false);
    if (phase === "error") {
      setPhase("idle");
      setMessage("");
    }
  }, [busy, phase, stopPolling]);

  const poll = useCallback(() => {
    stopPolling();
    timerRef.current = setInterval(async () => {
      const run = runRef.current;
      try {
        const res = await fetch(`/api/providers/web-login?provider=${encodeURIComponent(providerId)}`, { cache: "no-store" });
        const data = await res.json();
        if (run !== runRef.current) return;
        setViewer(data.status === "running" ? data.viewer || null : null);
        if (data.status === "success") {
          stopPolling();
          setPhase("success");
          setViewer(null);
          setMessage(data.email ? `${translate("Signed in as")} ${data.email}` : "Connection saved");
          if (typeof onConnected === "function") onConnected();
          // Let the "signed in" line register, then close itself — the user has
          // no action left to take in this dialog.
          closeTimerRef.current = setTimeout(() => {
            setOpen(false);
            setMessage("");
          }, 1500);
        } else if (data.status === "error" || data.status === "timeout" || data.status === "cancelled") {
          stopPolling();
          setPhase("error");
          setViewer(null);
          setMessage(data.error || translate("Login failed"));
        } else {
          setPhase((prev) => (prev === "opening" ? "waiting" : prev));
        }
      } catch {
        // transient network hiccup — keep polling
      }
    }, 2000);
  }, [providerId, onConnected, stopPolling]);

  const handleStart = useCallback(async () => {
    setPhase("opening");
    setMessage("");
    setViewer(null);
    const run = ++runRef.current;
    try {
      const res = await fetch("/api/providers/web-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, profile }),
      });
      const data = await res.json();
      if (run !== runRef.current) return;
      if (!res.ok) {
        setPhase("error");
        setMessage(data.error || translate("Failed to start login"));
        return;
      }
      setPhase("waiting");
      setViewer(data.viewer || null);
      setMessage(translate("Log in using the browser below. Your connection will be saved automatically."));
      poll();
    } catch (error) {
      if (run !== runRef.current) return;
      setPhase("error");
      setMessage(error?.message || translate("Failed to start login"));
    }
  }, [providerId, profile, poll]);

  const handleCancel = useCallback(() => {
    runRef.current += 1;
    setViewer(null);
    fetch(`/api/providers/web-login?provider=${encodeURIComponent(providerId)}`, { method: "DELETE" }).catch(() => {});
    stopPolling();
    setPhase("idle");
    setMessage("");
  }, [providerId, stopPolling]);

  return (
    <>
      <Button
        size={size}
        icon={phase === "success" ? "check_circle" : "language"}
        variant="secondary"
        onClick={() => {
          setPhase("idle");
          setMessage("");
          setOpen(true);
        }}
        title={translate("Log in using the embedded browser — your session is captured automatically")}
      >
        {phase === "success" ? translate("Connected") : translate("Login via Browser")}
      </Button>

      <Modal isOpen={open} onClose={handleClose} title={translate("Login via Browser")} size={busy ? "full" : "sm"} className={busy ? "!max-w-[1360px] [&>div:last-child]:!p-3 [&>div:last-child]:!max-h-none [&>div:last-child]:!h-[calc(100dvh-100px)] [&>div:last-child]:!overflow-hidden" : "max-h-[calc(100dvh-32px)]"}>
        <div className={`flex flex-col gap-3 ${busy ? "h-full min-h-0" : ""}`}>
          {!busy && <p className="text-xs text-text-muted">Log in securely below. Profiles preserve your sign-ins and can be shared across providers.</p>}
          <div className="shrink-0">
            <BrowserProfilePicker value={profile} onChange={pickProfile} disabled={busy} onAvailabilityChange={(selected) => setProfileAvailable(Boolean(selected && !selected.busy))} />
          </div>

          {phase !== "idle" && (
            <div className={`shrink-0 rounded-[10px] border border-border bg-surface-2 px-3 py-2 ${phase === "error" ? "text-red-500" : phase === "success" ? "text-green-600 dark:text-green-400" : "text-text-muted"}`} role={phase === "error" ? "alert" : "status"}>
              <div className="flex items-center gap-2 text-xs">
                <span aria-hidden="true" className={`material-symbols-outlined text-[18px] ${busy ? "animate-spin" : ""}`}>{phase === "success" ? "check_circle" : phase === "error" ? "error" : "progress_activity"}</span>
                <span>{message || (phase === "opening" ? "Opening secure browser…" : phase === "waiting" ? "Waiting for you to log in. Your connection will be saved automatically." : "Connection saved")}</span>
              </div>
            </div>
          )}

          {busy && viewer?.token ? <RemoteLoginBrowser token={viewer.token} /> : busy && <div className="flex min-h-0 flex-1 items-center justify-center rounded-[12px] border border-border bg-surface-2 text-sm text-text-muted">Opening browser viewer…</div>}
          <div className="flex shrink-0 gap-2">
            {phase === "success" ? (
              <Button onClick={handleClose} fullWidth>{translate("Done")}</Button>
            ) : busy ? (
              <Button onClick={handleCancel} variant="ghost" fullWidth>{translate("Cancel")}</Button>
            ) : (
              <>
                <Button onClick={handleStart} fullWidth disabled={!profileAvailable}>
                  {translate("Open Browser & Login")}
                </Button>
                <Button onClick={handleClose} variant="ghost" fullWidth disabled={busy}>
                  {translate("Close")}
                </Button>
              </>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

WebLoginButton.propTypes = {
  providerId: PropTypes.string.isRequired,
  onConnected: PropTypes.func,
  size: PropTypes.oneOf(["sm", "md", "lg"]),
};
