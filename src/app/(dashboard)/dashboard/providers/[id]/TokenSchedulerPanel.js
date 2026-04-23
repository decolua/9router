"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Card, Button } from "@/shared/components";

const POLL_INTERVAL = 10_000; // 10 seconds

function formatMs(ms) {
  if (!ms) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr`;
}

function formatTimestamp(iso) {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }) + ", " + d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function formatLogTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

const STATUS_COLORS = {
  recovered: "text-emerald-500",
  "pre-refreshed": "text-blue-400",
  failed: "text-red-400",
  skipped: "text-yellow-500",
};

export default function TokenSchedulerPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const pollRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/token-scheduler");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // Silently fail — panel is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [fetchStatus]);

  const handleRunNow = async () => {
    setRunning(true);
    try {
      await fetch("/api/token-scheduler/run", { method: "POST" });
      await fetchStatus();
    } catch {
      // ignore
    } finally {
      setRunning(false);
    }
  };

  const handleToggle = async () => {
    const action = data?.status === "running" ? "stop" : "start";
    try {
      await fetch("/api/token-scheduler", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await fetchStatus();
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="animate-pulse h-32" />
      </Card>
    );
  }

  if (!data) return null;

  const isRunning = data.status === "running";

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-primary">schedule</span>
          <div>
            <h2 className="text-lg font-semibold leading-tight">Token Scheduler</h2>
            <p className="text-xs text-text-muted">Auto-recovery for expired/invalid accounts</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleToggle}
            title={isRunning ? "Stop scheduler" : "Start scheduler"}
          >
            {isRunning ? "Stop" : "Start"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="play_arrow"
            onClick={handleRunNow}
            disabled={running}
          >
            {running ? "Running..." : "Run Now"}
          </Button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm mb-4">
        <div className="flex items-center gap-2">
          <span className="text-text-muted">Status:</span>
          <span className={isRunning ? "text-emerald-500 font-medium" : "text-red-400 font-medium"}>
            {isRunning ? "Running" : "Stopped"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-muted">Credentials:</span>
          <span className="text-text-main font-medium">{data.credentials} loaded</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-text-muted">Check Interval:</span>
          <span className="text-text-main">{formatMs(data.checkInterval)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-muted">Pre-refresh:</span>
          <span className="text-text-main">{formatMs(data.preRefreshWindow)}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-text-muted">Last Check:</span>
          <span className="text-text-main">{formatTimestamp(data.lastCheckAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-muted">Last Pre-refresh:</span>
          <span className="text-text-main">{formatTimestamp(data.lastPreRefreshAt)}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-text-muted">Total Recovered:</span>
          <span className="text-emerald-500 font-medium">{data.totalRecovered}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-muted">Total Failed:</span>
          <span className={`font-medium ${data.totalFailed > 0 ? "text-red-400" : "text-text-main"}`}>
            {data.totalFailed}
          </span>
        </div>
      </div>

      {/* Recovery Log */}
      {data.recoveryLog && data.recoveryLog.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2 text-text-secondary">Recovery Log</h3>
          <div className="max-h-48 overflow-y-auto rounded-lg bg-black/[0.03] dark:bg-white/[0.03] p-2 space-y-0.5">
            {data.recoveryLog.map((entry, i) => (
              <div
                key={`${entry.timestamp}-${i}`}
                className="flex items-center gap-3 text-xs font-mono leading-relaxed px-1"
              >
                <span className="text-text-muted shrink-0 w-[85px]">
                  {formatLogTime(entry.timestamp)}
                </span>
                <span className={`shrink-0 w-[90px] ${STATUS_COLORS[entry.status] || "text-text-muted"}`}>
                  {entry.status}
                </span>
                <span className="text-text-secondary shrink-0 max-w-[220px] truncate" title={entry.email}>
                  {entry.email}
                </span>
                <span className="text-text-muted truncate">
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty log state */}
      {(!data.recoveryLog || data.recoveryLog.length === 0) && (
        <div className="text-center py-4">
          <p className="text-xs text-text-muted">No recovery events yet</p>
        </div>
      )}
    </Card>
  );
}
