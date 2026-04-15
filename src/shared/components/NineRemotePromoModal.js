"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

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

const NINE_REMOTE_URL = "https://9remote.cc";

export default function NineRemotePromoModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    const onEsc = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", onEsc); };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-sm rounded-xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col bg-surface border border-black/10 dark:border-white/10">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5 dark:border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#FF570A" }}>
              <span className="material-symbols-outlined text-white text-base">terminal</span>
            </div>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ fontFamily: "monospace", color: "#FF570A" }}>9Remote</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 text-text-muted hover:text-text-main transition-colors"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="px-7 py-7 pb-9 flex flex-col gap-6">
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
          <div className="flex gap-2 w-full">
            {FEATURES.map(({ icon, label, desc }) => (
              <div key={label} className="flex-1 flex flex-col items-center gap-1.5 py-4 px-1 rounded-xl border border-black/10 dark:border-white/10 bg-bg-alt">
                <span className="material-symbols-outlined" style={{ fontSize: 22, color: "#ff6e33" }}>{icon}</span>
                <p className="text-xs font-semibold text-text-main">{label}</p>
                <p className="text-[10px] text-text-muted text-center leading-4">{desc}</p>
              </div>
            ))}
          </div>

          {/* Bullets */}
          <div className="flex flex-col gap-3 w-full">
            {BULLETS.map(({ icon, text }) => (
              <div key={icon} className="flex items-center gap-2.5">
                <span className="material-symbols-outlined flex-shrink-0" style={{ fontSize: 16, color: "#ff6e33" }}>{icon}</span>
                <span className="text-xs text-text-muted">{text}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={() => window.open(NINE_REMOTE_URL, "_blank")}
            className="w-full py-3.5 flex items-center justify-center gap-2 text-sm font-semibold text-white rounded-xl hover:opacity-90 active:scale-[0.98] transition-all"
            style={{ background: "#FF570A", boxShadow: "0 4px 16px rgba(255,87,10,0.35)" }}
          >
            <span className="material-symbols-outlined text-base">open_in_new</span>
            Get 9Remote
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
