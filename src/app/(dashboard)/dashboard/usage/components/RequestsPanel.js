"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import { fmt } from "./UsageTable";

// Auto-update relative time / duration displays every second without
// re-rendering the parent (UsageStats).
function useTickEverySecond() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

function timeAgo(timestamp) {
  if (!timestamp) return "—";
  const diff = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m${rem}s`;
}

const PANEL_TABS = [
  { value: "recent", label: "Recent Requests" },
  { value: "sessions", label: "Sessions" },
];

/**
 * Small tabbed card that lives where the old Recent Requests panel sat.
 * Tab 1: Recent Requests (recent per-request tallies).
 * Tab 2: Concurrent Sessions (in-flight + just-finished requests with
 *        client id / session id / model / in / out tokens).
 *
 * @param {object} props
 * @param {Array}  props.recentRequests  - stats.recentRequests
 * @param {Array}  props.activeSessions  - stats.activeSessions
 */
export default function RequestsPanel({ recentRequests = [], activeSessions = [] }) {
  const [tab, setTab] = useState("recent");
  useTickEverySecond();

  return (
    <Card className="flex min-w-0 flex-col overflow-hidden" padding="sm" style={{ height: 480 }}>
      {/* Tab header */}
      <div className="flex items-center justify-between px-1 py-2 border-b border-border shrink-0 gap-2">
        <div className="flex items-center gap-1">
          {PANEL_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors ${
                tab === t.value
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-bg-subtle hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === "sessions" && (
          <span className="text-[11px] text-text-muted whitespace-nowrap">
            {activeSessions.filter((s) => s.status === "active").length} active
          </span>
        )}
      </div>

      {tab === "recent" ? (
        <RecentRequestsView requests={recentRequests} />
      ) : (
        <SessionsView sessions={activeSessions} />
      )}
    </Card>
  );
}

function RecentRequestsView({ requests = [] }) {
  if (!requests.length) {
    return <div className="flex-1 flex items-center justify-center text-text-muted text-sm">No requests yet.</div>;
  }
  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full min-w-[300px] border-collapse text-xs">
        <thead className="sticky top-0 bg-bg z-10">
          <tr className="border-b border-border">
            <th className="py-1.5 text-left font-semibold text-text-muted w-2"></th>
            <th className="py-1.5 text-left font-semibold text-text-muted">Model</th>
            <th className="py-1.5 text-right font-semibold text-text-muted whitespace-nowrap">In / Out</th>
            <th className="py-1.5 text-right font-semibold text-text-muted">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {requests.map((r, i) => {
            const ok = !r.status || r.status === "ok" || r.status === "success";
            return (
              <tr key={i} className="hover:bg-bg-subtle transition-colors">
                <td className="py-1.5">
                  <span className={`block w-1.5 h-1.5 rounded-full ${ok ? "bg-success" : "bg-error"}`} />
                </td>
                <td className="py-1.5 font-mono truncate max-w-[120px]" title={r.model}>{r.model}</td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <span className="text-primary">{fmt(r.promptTokens)}↑</span>{" "}
                  <span className="text-success">{fmt(r.completionTokens)}↓</span>
                </td>
                <td className="py-1.5 text-right text-text-muted whitespace-nowrap">{timeAgo(r.timestamp)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Ended (done / error / disconnected) rows stay visible for this long so the
// user can read the final in/out tally, then are hidden. Active rows always show.
const ENDED_VISIBILITY_MS = 15 * 1000;

function SessionsView({ sessions = [] }) {
  // useTickEverySecond (from parent) drives re-evaluation of the 15s cutoff.
  const now = Date.now();
  const visible = sessions.filter((s) => {
    if (s.status === "active") return true;
    if (!s.completedAt) return true; // not stamped yet — keep until we know
    return now - s.completedAt < ENDED_VISIBILITY_MS;
  });

  if (!visible.length) {
    return <div className="flex-1 flex items-center justify-center text-text-muted text-sm">No active sessions.</div>;
  }
  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full min-w-[320px] border-collapse text-xs">
        <thead className="sticky top-0 bg-bg z-10">
          <tr className="border-b border-border">
            <th className="py-1.5 text-left font-semibold text-text-muted w-2"></th>
            <th className="py-1.5 text-left font-semibold text-text-muted">Client IP</th>
            <th className="py-1.5 text-left font-semibold text-text-muted">Model</th>
            <th className="py-1.5 text-right font-semibold text-text-muted whitespace-nowrap">In / Out</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {visible.map((s) => {
            const isActive = s.status === "active";
            const isError = s.status === "error";
            const dot = isError ? "bg-error" : isActive ? "bg-primary animate-pulse" : "bg-success";
            const hasTokens = !(s.promptTokens == null && s.completionTokens == null);
            return (
              <tr key={s.requestId} className="hover:bg-bg-subtle transition-colors">
                <td className="py-1.5">
                  <span className={`block w-1.5 h-1.5 rounded-full ${dot}`} title={fmtDuration(s.durationMs)} />
                </td>
                <td className="py-1.5 font-mono truncate max-w-[110px]" title={s.clientId}>{s.clientId}</td>
                <td className="py-1.5 font-mono truncate max-w-[140px]" title={`${s.model} · ${s.provider}`}>{s.model}</td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  {hasTokens ? (
                    <>
                      <span className="text-primary">{fmt(s.promptTokens)}↑</span>{" "}
                      <span className="text-success">{fmt(s.completionTokens)}↓</span>
                    </>
                  ) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
