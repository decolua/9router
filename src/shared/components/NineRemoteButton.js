"use client";

import { useState, useEffect, useRef } from "react";
import NineRemoteModal from "./NineRemoteModal";

// step 0-4 từ 9remote SSE: 0=Stopped,1=Preparing,2=Connecting,3=Tunneling,4=Ready
const STEP = { STOPPED: 0, PREPARING: 1, CONNECTING: 2, TUNNELING: 3, READY: 4 };

// Retry interval khi 9remote chưa chạy (30s để không spam)
const RETRY_MS = 30000;

const stepStyle = (step, installed) => {
  if (!installed) return { color: "text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5", glow: null };
  switch (step) {
    case STEP.READY:   return { color: "text-emerald-500 hover:bg-emerald-500/10", glow: "drop-shadow(0 0 6px rgb(16 185 129 / 0.7))" };
    case STEP.STOPPED: return { color: "text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5", glow: null };
    default:           return { color: "text-amber-400 hover:bg-amber-400/10", glow: null };
  }
};

export default function NineRemoteButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [step, setStep] = useState(STEP.STOPPED);
  const esRef = useRef(null);
  const retryRef = useRef(null);

  const scheduleRetry = () => {
    clearTimeout(retryRef.current);
    retryRef.current = setTimeout(connect, RETRY_MS);
  };

  const connect = () => {
    esRef.current?.close();
    clearTimeout(retryRef.current);

    const es = new EventSource("http://localhost:2208/api/ui/events");

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "state") {
          setInstalled(true);
          setStep(data.step ?? STEP.STOPPED);
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      setStep(STEP.STOPPED);
      // 9remote not running — retry after delay
      scheduleRetry();
    };

    esRef.current = es;
  };

  useEffect(() => {
    // Check installed once on mount (no polling, just 1 call)
    fetch("/api/9remote/status")
      .then((r) => r.json())
      .then((d) => setInstalled(d.installed))
      .catch(() => {});

    connect();

    return () => {
      esRef.current?.close();
      clearTimeout(retryRef.current);
    };
  }, []);

  // When modal closes, reconnect SSE immediately (user may have just started 9remote)
  const handleClose = () => {
    setIsOpen(false);
    setTimeout(connect, 800);
  };

  const { color, glow } = stepStyle(step, installed);
  const isPulsing = installed && step >= STEP.PREPARING && step <= STEP.TUNNELING;

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-all ${color}`}
        style={glow ? { filter: glow } : {}}
        title="9Remote"
      >
        <span className={`material-symbols-outlined text-[18px]${isPulsing ? " animate-pulse" : ""}`}>
          computer
        </span>
        <span className="text-xs font-medium">Remote</span>
      </button>

      <NineRemoteModal
        isOpen={isOpen}
        onClose={handleClose}
        onInstalled={() => setInstalled(true)}
      />
    </>
  );
}
