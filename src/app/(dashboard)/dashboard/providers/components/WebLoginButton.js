"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { translate } from "@/i18n/runtime";

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

const PROFILE_ICON_BY_NAME = {
  default: "person",
  grok: "bolt",
  work: "work",
  personal: "home",
};

function profileIcon(name) {
  const lower = String(name).toLowerCase();
  for (const [key, icon] of Object.entries(PROFILE_ICON_BY_NAME)) {
    if (lower.includes(key)) return icon;
  }
  return "folder_shared";
}

const STAGES = [
  { key: "opening", label: "Opening browser window", icon: "open_in_new" },
  { key: "waiting", label: "Waiting for you to log in", icon: "hourglass_top" },
  { key: "saving", label: "Saving connection", icon: "save" },
];

/**
 * "Login via browser" for web-cookie providers: opens a HEADED Chrome window
 * on a SHARED browser profile (one Google login serves every provider via
 * "Continue with Google"), polls the capture session and auto-creates the
 * connection. No cookie ever reaches this component — only status.
 */
export default function WebLoginButton({ providerId, onConnected, size = "sm" }) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | opening | waiting | success | error
  const [message, setMessage] = useState("");
  const [profiles, setProfiles] = useState(["default"]);
  const [profile, setProfile] = useState("default");
  const timerRef = useRef(null);
  const closeTimerRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    stopPolling();
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, [stopPolling]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/providers/web-login", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data.profiles)) return;
        const saved = typeof window !== "undefined" ? window.localStorage.getItem(`weblogin:profile:${providerId}`) : null;
        const list = data.profiles.includes("default") ? data.profiles : ["default", ...data.profiles];
        setProfiles(list);
        setProfile(saved && list.includes(saved) ? saved : "default");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open, providerId]);

  const pickProfile = useCallback((value) => {
    setProfile(value);
    if (typeof window !== "undefined") window.localStorage.setItem(`weblogin:profile:${providerId}`, value);
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
      try {
        const res = await fetch(`/api/providers/web-login?provider=${encodeURIComponent(providerId)}`, { cache: "no-store" });
        const data = await res.json();
        if (data.status === "success") {
          stopPolling();
          setPhase("success");
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
    try {
      const res = await fetch("/api/providers/web-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, profile }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPhase("error");
        setMessage(data.error || translate("Failed to start login"));
        return;
      }
      setPhase("waiting");
      setMessage(translate("A browser window has opened — log in there, this page updates itself."));
      poll();
    } catch (error) {
      setPhase("error");
      setMessage(error?.message || translate("Failed to start login"));
    }
  }, [providerId, profile, poll]);

  const handleCancel = useCallback(() => {
    fetch(`/api/providers/web-login?provider=${encodeURIComponent(providerId)}`, { method: "DELETE" }).catch(() => {});
    stopPolling();
    setPhase("idle");
    setMessage("");
  }, [providerId, stopPolling]);

  const handleNewProfile = useCallback(() => {
    const name = window.prompt(translate("New browser profile name (e.g. work, personal):"), "");
    if (!name) return;
    const cleaned = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
    if (!cleaned) return;
    setProfiles((prev) => (prev.includes(cleaned) ? prev : [...prev, cleaned]));
    pickProfile(cleaned);
  }, [pickProfile]);

  const activeStage = phase === "opening" ? 0 : phase === "waiting" ? 1 : phase === "success" ? 2 : -1;

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
        title={translate("Open a browser window, log in by hand — the cookie is captured automatically")}
      >
        {phase === "success" ? translate("Connected") : translate("Login via Browser")}
      </Button>

      <Modal isOpen={open} onClose={handleClose} title={translate("Login via Browser")} size="sm">
        <div className="flex flex-col gap-4">
          <p className="text-xs text-text-muted">
            {translate(
              "A Chrome window opens on a shared browser profile. Log in there — the session is captured automatically. One Google login in a profile makes every other provider a single “Continue with Google” click."
            )}
          </p>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
                {translate("Browser profile")}
              </span>
              <button
                type="button"
                onClick={handleNewProfile}
                disabled={busy}
                className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                {translate("New profile")}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {profiles.map((name) => {
                const selected = name === profile;
                return (
                  <button
                    key={name}
                    type="button"
                    disabled={busy}
                    onClick={() => pickProfile(name)}
                    className={`flex items-center gap-2 rounded border border-accent/30 bg-sidebar p-2 text-left text-sm transition-colors focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 ${
                      selected ? "border-primary ring-1 ring-primary" : "hover:border-accent/60"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[18px] text-text-muted">{profileIcon(name)}</span>
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    {selected && (
                      <span className="material-symbols-outlined text-[16px] text-primary">check_circle</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {phase !== "idle" && (
            <div className="rounded border border-accent/20 bg-sidebar/50 p-3">
              {phase === "success" ? (
                <div className="flex items-center gap-2 text-sm font-medium text-green-400">
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  ✓ {message || translate("Connection saved")}
                </div>
              ) : phase === "error" ? (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-yellow-400">
                    <span className="material-symbols-outlined text-[18px]">error</span>
                    {translate("Login failed")}
                  </div>
                  {message && <p className="pl-6 text-xs text-red-500 break-words">{message}</p>}
                </div>
              ) : (
                <ol className="flex flex-col gap-2">
                  {STAGES.map((stage, index) => {
                    const done = index < activeStage;
                    const active = index === activeStage;
                    return (
                      <li
                        key={stage.key}
                        className={`flex items-center gap-2 text-sm ${
                          done ? "text-green-400" : active ? "text-primary" : "text-text-muted opacity-50"
                        }`}
                      >
                        <span className={`material-symbols-outlined text-[18px] ${active ? "animate-pulse" : ""}`}>
                          {done ? "check_circle" : stage.icon}
                        </span>
                        {translate(stage.label)}
                      </li>
                    );
                  })}
                  {message && <li className="pl-6 text-xs text-text-muted">{message}</li>}
                </ol>
              )}
            </div>
          )}

          <div className="flex gap-2">
            {phase === "success" ? (
              <Button onClick={handleClose} fullWidth>{translate("Done")}</Button>
            ) : busy ? (
              <Button onClick={handleCancel} variant="ghost" fullWidth>{translate("Cancel")}</Button>
            ) : (
              <>
                <Button onClick={handleStart} fullWidth disabled={phase === "error" && !message}>
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
