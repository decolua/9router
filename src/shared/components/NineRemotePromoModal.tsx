"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { 
  Terminal, 
  Selection as Desktop, 
  FolderOpen, 
  QrCode as QrCodeScanner, 
  WifiSlash as WifiOff, 
  Devices,
  X,
  ArrowSquareOut as ExternalLink
} from "@phosphor-icons/react";

const FEATURES = [
  { icon: Terminal, label: "Terminal", desc: "Full shell access" },
  { icon: Desktop, label: "Desktop", desc: "Screen sharing" },
  { icon: FolderOpen, label: "Files", desc: "Browse & edit files" },
];

const BULLETS = [
  { icon: QrCodeScanner, text: "Scan QR to connect instantly" },
  { icon: WifiOff, text: "No port forwarding needed" },
  { icon: Devices, text: "Works on any device" },
];

const NINE_REMOTE_URL = "https://9remote.cc";

interface NineRemotePromoModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NineRemotePromoModal({ isOpen, onClose }: NineRemotePromoModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onEsc);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown", onEsc); };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col bg-background border border-border/50">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50 bg-muted/5">
          <div className="flex items-center gap-3">
            <div className="size-7 rounded-lg flex items-center justify-center bg-[#FF570A] text-white">
              <Terminal className="size-4" weight="bold" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#FF570A] font-mono">9Remote</span>
          </div>
          <button
            onClick={onClose}
            className="size-7 flex items-center justify-center rounded-lg bg-muted/20 border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="size-4" weight="bold" />
          </button>
        </div>

        {/* Body */}
        <div className="px-7 py-7 pb-9 flex flex-col gap-6">
          {/* Hero */}
          <div className="flex flex-col items-center gap-2 text-center mt-2">
            <div
              className="size-14 rounded-2xl flex items-center justify-center mb-1 bg-[#FF570A] shadow-[0_8px_32px_rgba(255,87,10,0.35)]"
            >
              <Terminal className="size-8 text-white" weight="bold" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">9Remote</h1>
            <p className="text-xs text-muted-foreground font-medium leading-relaxed max-w-[220px]">
              Access your terminal, desktop &amp; files from anywhere.
            </p>
          </div>

          {/* Feature cards */}
          <div className="flex gap-2 w-full">
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex-1 flex flex-col items-center gap-1.5 py-4 px-1 rounded-xl border border-border/50 bg-muted/5">
                <Icon className="size-6 text-[#ff6e33]" weight="bold" />
                <p className="text-[10px] font-bold uppercase tracking-tight text-foreground">{label}</p>
                <p className="text-[9px] text-muted-foreground text-center leading-tight font-medium opacity-70">{desc}</p>
              </div>
            ))}
          </div>

          {/* Bullets */}
          <div className="flex flex-col gap-3 w-full pl-2">
            {BULLETS.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2.5">
                <Icon className="size-4 text-[#ff6e33] flex-shrink-0" weight="bold" />
                <span className="text-[11px] text-muted-foreground font-semibold">{text}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <button
            onClick={() => window.open(NINE_REMOTE_URL, "_blank")}
            className="w-full py-3.5 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest text-white rounded-xl hover:opacity-90 active:scale-[0.98] transition-all bg-[#FF570A] shadow-[0_4px_16px_rgba(255,87,10,0.35)]"
          >
            <ExternalLink className="size-4" weight="bold" />
            Get 9Remote
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
