"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

/**
 * "Lấy Control Key" control for the opendesign-go quota card.
 *
 * WHY the user has to do something in a browser: OpenDesign's CLI device flow
 * only completes when the *signed-in user's* session approves the code —
 * POST /cli/device-authorizations/{id}/approve answers 401 "unauthenticated"
 * to anything that is not the user's browser cookie, so 9router cannot finish
 * this alone. This component therefore just shows the code, opens the
 * activation page, and polls until the approval lands.
 *
 * The Control Key itself never reaches this component: the poll route stores it
 * on the connection and answers `{status:"approved", saved:true}`, which is all
 * the parent needs to re-fetch quota.
 */

const POLL_SAFETY_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_EXPIRY_MS = 15 * 60 * 1000;
const MIN_INTERVAL_MS = 1000;

export default function OpenDesignKeyButton({ connectionId, onDone, className = "" }) {
  // idle | starting | waiting | approved | error
  const [phase, setPhase] = useState("idle");
  const [device, setDevice] = useState(null);
  const [error, setError] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const { copied, copy } = useCopyToClipboard();

  // Refs, not state, for everything the interval reads: a state value captured
  // in the closure would keep the first render's copy forever and the poll
  // would keep running after unmount / after the phase already changed.
  const pollTimerRef = useRef(null);
  const pollDeadlineRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const mountedRef = useRef(true);
  const tickTimerRef = useRef(null);

  const stopPolling = useCallback(() => {
    stopRequestedRef.current = true;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }, []);

  // Unmount: kill both timers so a closed card cannot keep a poll loop or a
  // countdown alive against the server.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopRequestedRef.current = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
      pollTimerRef.current = null;
      tickTimerRef.current = null;
    };
  }, []);

  const fail = useCallback((message) => {
    stopPolling();
    if (!mountedRef.current) return;
    setPhase("error");
    setError(message || "Không lấy được Control Key");
  }, [stopPolling]);

  const pollOnce = useCallback(
    async (nextDevice) => {
      if (stopRequestedRef.current) return;

      let payload = null;
      let httpStatus = 0;
      try {
        const response = await fetch(
          `/api/opendesign/device/${encodeURIComponent(nextDevice.deviceId)}?connectionId=${encodeURIComponent(connectionId)}`,
          { cache: "no-store" },
        );
        httpStatus = response.status;
        payload = await response.json().catch(() => null);
      } catch (err) {
        // A single network blip must not kill a 15-minute flow — only the
        // deadline and explicit server errors do.
        if (stopRequestedRef.current || !mountedRef.current) return;
        if (Date.now() >= pollDeadlineRef.current) {
          fail("Hết thời gian chờ duyệt — bấm lấy lại Control Key");
          return;
        }
        scheduleNextPoll(nextDevice);
        return;
      }

      if (stopRequestedRef.current || !mountedRef.current) return;

      if (payload?.status === "approved" && payload?.saved === true) {
        stopPolling();
        setPhase("approved");
        setError(null);
        onDone?.();
        return;
      }

      if (httpStatus >= 500 || payload?.status === "error") {
        // Server-side failure (upstream 5xx, unknown device, invalid key):
        // retrying the same deviceId will not help, surface it and stop.
        fail(payload?.error || `Không kiểm tra được trạng thái duyệt (HTTP ${httpStatus})`);
        return;
      }

      if (payload?.status === "denied" || payload?.status === "expired") {
        fail(
          payload.status === "denied"
            ? "Yêu cầu đã bị từ chối trên trình duyệt — bấm lấy lại Control Key"
            : "Mã xác nhận đã hết hạn — bấm lấy lại Control Key",
        );
        return;
      }

      // pending (or anything else transient): keep waiting until the deadline.
      if (Date.now() >= pollDeadlineRef.current) {
        fail("Hết thời gian chờ duyệt — bấm lấy lại Control Key");
        return;
      }
      scheduleNextPoll(nextDevice);
    },
    [connectionId, fail, onDone, stopPolling],
  );

  // Defined after pollOnce but only called from within it, so the reference is
  // resolved at call time (function declaration hoisting keeps this simple).
  function scheduleNextPoll(nextDevice) {
    const delay = Math.max(MIN_INTERVAL_MS, nextDevice.intervalMs || 2500);
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = setTimeout(() => {
      pollTimerRef.current = null;
      pollOnce(nextDevice);
    }, delay);
  }

  const startPolling = useCallback(
    (nextDevice) => {
      stopPolling();
      stopRequestedRef.current = false;

      const expiresMs = Date.parse(nextDevice.expiresAt);
      pollDeadlineRef.current = Number.isFinite(expiresMs)
        ? expiresMs
        // No expiry from the vendor: assume the advertised ~15 minutes, then
        // add a margin so the UI gives up instead of polling forever.
        : Date.now() + DEFAULT_EXPIRY_MS + POLL_SAFETY_MARGIN_MS;

      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
      const updateCountdown = () => {
        if (!mountedRef.current) return;
        setSecondsLeft(Math.max(0, Math.ceil((pollDeadlineRef.current - Date.now()) / 1000)));
      };
      updateCountdown();
      tickTimerRef.current = setInterval(updateCountdown, 1000);

      scheduleNextPoll(nextDevice);
    },
    [stopPolling],
  );

  const startFlow = useCallback(async () => {
    stopPolling();
    stopRequestedRef.current = false;
    setPhase("starting");
    setError(null);
    setDevice(null);
    setSecondsLeft(0);

    try {
      const response = await fetch("/api/opendesign/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.deviceId || !payload?.userCode) {
        throw new Error(payload?.error || `Không tạo được mã xác nhận (HTTP ${response.status})`);
      }
      if (!mountedRef.current) return;

      setDevice(payload);
      setPhase("waiting");
      startPolling(payload);
    } catch (err) {
      fail(err?.message || "Không tạo được mã xác nhận");
    }
  }, [connectionId, fail, startPolling, stopPolling]);

  const handleRetry = useCallback(() => {
    stopPolling();
    setPhase("idle");
    setError(null);
    setDevice(null);
    setSecondsLeft(0);
  }, [stopPolling]);

  if (phase === "idle" || phase === "error") {
    return (
      <div className={`space-y-1.5 ${className}`}>
        <button
          type="button"
          onClick={phase === "error" ? handleRetry : startFlow}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary/60"
        >
          <span className="material-symbols-outlined text-[15px]">key</span>
          <span>{phase === "error" ? "Thử lại" : "Lấy Control Key"}</span>
        </button>
        {phase === "error" && (
          <p className="px-1 text-[10px] leading-relaxed text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    );
  }

  if (phase === "starting") {
    return (
      <div className={`flex items-center gap-2 px-1 py-1 text-[11px] text-text-muted ${className}`}>
        <span className="material-symbols-outlined text-[15px] animate-spin">progress_activity</span>
        <span>Đang tạo mã xác nhận…</span>
      </div>
    );
  }

  if (phase === "approved") {
    return (
      <div className={`flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 px-2.5 py-1.5 text-[11px] font-medium text-green-700 dark:text-green-400 ${className}`}>
        <span className="material-symbols-outlined text-[15px]">check_circle</span>
        <span>Đã lưu Control Key</span>
      </div>
    );
  }

  // waiting
  return (
    <div className={`space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5 ${className}`}>
      <p className="text-[11px] font-medium text-text-primary">
        Nhập mã này trên trang duyệt của OpenDesign
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-md border border-black/10 bg-white px-2.5 py-1 font-mono text-base font-bold tracking-[0.2em] text-text-primary dark:border-white/10 dark:bg-black/30">
          {device?.userCode}
        </code>
        <button
          type="button"
          onClick={() => copy(device?.userCode, "user-code")}
          className="inline-flex items-center gap-1 rounded-md border border-black/10 px-1.5 py-0.5 text-[10px] text-text-muted transition-colors hover:text-primary dark:border-white/10"
          title="Copy mã"
        >
          <span className="material-symbols-outlined text-[13px]">
            {copied === "user-code" ? "check" : "content_copy"}
          </span>
          Copy
        </button>
      </div>
      {device?.activationUrl && (
        <a
          href={device.activationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
        >
          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
          Mở trang duyệt (open-design.ai)
        </a>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
        <span className="material-symbols-outlined text-[13px] animate-spin">progress_activity</span>
        <span>Đang chờ bạn duyệt trên trình duyệt…</span>
        {secondsLeft > 0 && <span className="tabular-nums">(còn {secondsLeft}s)</span>}
      </div>
      <button
        type="button"
        onClick={handleRetry}
        className="text-[10px] text-text-muted underline-offset-2 hover:text-text-primary hover:underline"
      >
        Huỷ / lấy mã khác
      </button>
    </div>
  );
}
