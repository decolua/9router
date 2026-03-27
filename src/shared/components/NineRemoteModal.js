"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

const S = {
  CHECKING: "checking",
  NOT_INSTALLED: "not_installed",
  NOT_RUNNING: "not_running",
  INSTALLING: "installing",
  STARTING: "starting",
  RUNNING: "running",
  ERROR: "error",
};

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 60000;

const FEATURES = [
  { icon: "terminal", label: "Terminal", desc: "Full shell access" },
  { icon: "cast", label: "Desktop", desc: "Screen sharing" },
  { icon: "folder_open", label: "Files", desc: "Browse & edit files" },
];

const BULLETS = [
  { icon: "qr_code_scanner", text: "Scan QR to connect instantly" },
  { icon: "wifi_off", text: "No port forwarding needed" },
  { icon: "devices", text: "Works on any device" },
];

export default function NineRemoteModal({ isOpen, onClose, onInstalled }) {
  const [state, setState] = useState(S.CHECKING);
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef(null);

  const stopPolling = () => {
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
  };

  const pollUntilRunning = useCallback(() => {
    stopPolling();
    const startedAt = Date.now();
    const poll = async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        setState(S.ERROR);
        setErrorMsg("9Remote is taking too long to start. Try running `9remote ui` manually.");
        return;
      }
      try {
        const res = await fetch("/api/9remote/status");
        const data = await res.json();
        if (data.running) { setState(S.RUNNING); return; }
      } catch {}
      pollRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
  }, []);

  const checkAndInit = useCallback(async () => {
    setState(S.CHECKING);
    setErrorMsg("");
    try {
      const res = await fetch("/api/9remote/status");
      const data = await res.json();
      if (data.running) { setState(S.RUNNING); return; }
      if (!data.installed) { setState(S.NOT_INSTALLED); return; }
      setState(S.NOT_RUNNING);
    } catch (err) { setState(S.ERROR); setErrorMsg(err.message); }
  }, []);

  const handleStart = useCallback(async () => {
    setState(S.STARTING);
    try {
      const res = await fetch("/api/9remote/start", { method: "POST" });
      if (!res.ok) throw new Error("Failed to start 9Remote");
      pollUntilRunning();
    } catch (err) { setState(S.ERROR); setErrorMsg(err.message); }
  }, [pollUntilRunning]);

  const handleInstall = async () => {
    setState(S.INSTALLING);
    setErrorMsg("");
    try {
      const res = await fetch("/api/9remote/install", { method: "POST" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || "Install failed"); }
      onInstalled?.();
      await handleStart();
    } catch (err) { setState(S.ERROR); setErrorMsg(err.message); }
  };

  useEffect(() => {
    if (isOpen) checkAndInit();
    else stopPolling();
    return stopPolling;
  }, [isOpen, checkAndInit]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    const onEsc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", onEsc); };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const btnCfg = {
    [S.NOT_INSTALLED]: { label: "Install 9Remote", icon: "download",      onClick: handleInstall, loading: false },
    [S.INSTALLING]:    { label: "Installing...",    icon: "hourglass_top", onClick: null,          loading: true  },
    [S.NOT_RUNNING]:   { label: "Start 9Remote",    icon: "play_arrow",    onClick: handleStart,   loading: false },
    [S.STARTING]:      { label: "Starting...",      icon: "hourglass_top", onClick: null,          loading: true  },
    [S.CHECKING]:      { label: "Checking...",      icon: "hourglass_top", onClick: null,          loading: true  },
  }[state];

  // Running — iframe only
  if (state === S.RUNNING) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative rounded-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200" style={{ width: 480, height: "90vh" }}>
          <iframe
            src="http://localhost:2208"
            className="border-0 block w-full h-full"
            title="9Remote UI"
          />
        </div>
      </div>,
      document.body
    );
  }

  // Error state
  if (state === S.ERROR) {
    return createPortal(
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-sm rounded-xl overflow-hidden shadow-2xl bg-surface border border-black/10 dark:border-white/10 animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 dark:border-white/5">
            <span className="text-sm font-semibold text-text-main">9Remote</span>
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 text-text-muted hover:text-text-main transition-colors">
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
          <div className="flex flex-col items-center gap-5 py-12 px-6 text-center">
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-red-400 text-[28px]">error</span>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-text-main">Something went wrong</p>
              <p className="text-xs text-text-muted font-mono break-all">{errorMsg}</p>
            </div>
            <button onClick={checkAndInit} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 text-sm text-text-main hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              <span className="material-symbols-outlined text-base">refresh</span>
              Retry
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // Main card — layout cố định, chỉ đổi button
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-sm rounded-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col bg-surface border border-black/10 dark:border-white/10"
        style={{ minHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 dark:border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#FF570A" }}>
              <span className="material-symbols-outlined text-white text-base">terminal</span>
            </div>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ fontFamily: "monospace", color: "#FF570A" }}>9Remote</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 text-text-muted hover:text-text-main transition-colors">
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="px-7 py-7 pb-9 flex flex-col flex-1 justify-between">
          {/* Hero */}
          <div className="flex flex-col items-center gap-2 text-center mt-2">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-1"
              style={{ background: "#FF570A", boxShadow: "rgba(255,87,10,0.35) 0px 8px 32px" }}
            >
              <span className="material-symbols-outlined text-white" style={{ fontSize: 30 }}>terminal</span>
            </div>
            <h1 className="text-lg font-bold text-text-main tracking-tight">9Remote</h1>
            <p className="text-xs text-text-muted leading-5 max-w-[220px]">
              Access your terminal, desktop &amp; files from anywhere
            </p>
          </div>

          {/* Feature cards */}
          <div className="flex gap-2 w-full mt-6">
            {FEATURES.map(({ icon, label, desc }) => (
              <div key={label} className="flex-1 flex flex-col items-center gap-1.5 py-4 px-1 rounded-xl border border-black/10 dark:border-white/10 bg-bg-alt">
                <span className="material-symbols-outlined" style={{ fontSize: 22, color: "#ff6e33" }}>{icon}</span>
                <p className="text-xs font-semibold text-text-main">{label}</p>
                <p className="text-[10px] text-text-muted text-center leading-4">{desc}</p>
              </div>
            ))}
          </div>

          {/* Bullets */}
          <div className="flex flex-col gap-3 w-full mt-5">
            {BULLETS.map(({ icon, text }) => (
              <div key={icon} className="flex items-center gap-2.5">
                <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 16, color: "#ff6e33" }}>{icon}</span>
                <span className="text-xs text-text-muted">{text}</span>
              </div>
            ))}
          </div>

          {/* CTA button */}
          {btnCfg && (
            <button
              onClick={btnCfg.onClick ?? undefined}
              disabled={btnCfg.loading}
              className={`mt-7 w-full py-3.5 flex items-center justify-center gap-2 text-sm font-semibold text-white rounded-xl transition-all ${
                btnCfg.loading
                  ? "opacity-60 cursor-not-allowed"
                  : "hover:opacity-90 active:scale-[0.98]"
              }`}
              style={{
                background: "#FF570A",
                boxShadow: btnCfg.loading ? "none" : "0 4px 16px rgba(255,87,10,0.35)",
              }}
            >
              {btnCfg.loading ? (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: "300ms" }} />
                </span>
              ) : (
                <span className="material-symbols-outlined text-base">{btnCfg.icon}</span>
              )}
              {btnCfg.label}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
