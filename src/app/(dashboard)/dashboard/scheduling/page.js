"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, Button, Badge } from "@/shared/components";
import { CardSkeleton } from "@/shared/components/Loading";
import { cn } from "@/shared/utils/cn";

/**
 * Scheduling Diagnostics — read-only visualization of the session-affinity
 * scheduling layers:
 *
 *   - session identity probe (which resolution level matched, and how stable
 *     the alternative candidate keys are)
 *   - per-account in-flight load (the concurrency gate)
 *   - session -> account bindings (the affinity store)
 *   - effective scheduling settings
 *
 * Data comes exclusively from GET /api/diagnostics/scheduling. This page never
 * mutates routing state except through the two explicit maintenance actions
 * (toggle probe / reset load counters).
 */

const REFRESH_MS = 5000;

// Identity levels in resolver priority order, with human labels.
const LEVEL_META = [
  { key: "client", label: "Client session", hint: "Stable id from the client — best case", tone: "success" },
  { key: "assistant_text", label: "Assistant text hash", hint: "Derived from the last assistant reply", tone: "warning" },
  { key: "workspace", label: "Workspace", hint: "Workspace/project scoped fallback", tone: "info" },
  { key: "connection_fallback", label: "Connection fallback", hint: "Per-connection, drifts over time", tone: "warning" },
  { key: "random", label: "Random", hint: "Could not be identified — new session every time", tone: "error" },
];

const CANDIDATE_META = [
  { key: "clientSessionId", label: "Client session id" },
  { key: "conversationId", label: "Conversation id / prompt_cache_key" },
  { key: "firstUserMsg", label: "First user message" },
  { key: "transport", label: "Transport fingerprint" },
];

function pct(value) {
  if (value === null || value === undefined) return "–";
  return `${(value * 100).toFixed(1)}%`;
}

function shortId(id) {
  if (!id) return "–";
  const s = String(id);
  return s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-3)}` : s;
}

function StatTile({ icon, label, value, sub, tone = "default" }) {
  const tones = {
    default: "bg-bg text-text-muted",
    success: "bg-green-500/10 text-green-500",
    info: "bg-blue-500/10 text-blue-500",
    warning: "bg-amber-500/10 text-amber-500",
  };
  return (
    <div className="p-4 rounded-[10px] bg-bg border border-border-subtle flex items-start gap-3">
      <div className={cn("p-2 rounded-[10px] shrink-0", tones[tone])}>
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-text-muted">{label}</p>
        <p className="text-xl font-semibold text-text-main leading-tight truncate">{value}</p>
        {sub ? <p className="text-xs text-text-muted mt-0.5 truncate">{sub}</p> : null}
      </div>
    </div>
  );
}

function BarRow({ label, hint, count, total, tone }) {
  const ratio = total > 0 ? count / total : 0;
  const width = `${Math.max(ratio * 100, count > 0 ? 2 : 0)}%`;
  const bars = {
    success: "bg-green-500",
    warning: "bg-amber-500",
    info: "bg-blue-500",
    error: "bg-red-500",
    default: "bg-brand-500",
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-text-main truncate">{label}</span>
        <span className="text-text-muted shrink-0 tabular-nums">
          {count} · {pct(ratio)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", bars[tone] || bars.default)} style={{ width }} />
      </div>
      {hint ? <p className="text-xs text-text-muted">{hint}</p> : null}
    </div>
  );
}

export default function SchedulingDiagnosticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/diagnostics/scheduling", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || json?.ok !== true) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      setData(json);
      setError("");
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message || "Failed to load diagnostics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) clearInterval(timerRef.current);
      return undefined;
    }
    timerRef.current = setInterval(load, REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, load]);

  const action = useCallback(
    async (act) => {
      setBusy(act);
      try {
        await fetch("/api/diagnostics/scheduling", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: act }),
        });
        await load();
      } catch (err) {
        setError(err.message || "Action failed");
      } finally {
        setBusy("");
      }
    },
    [load]
  );

  const settings = data?.settings || {};
  const probe = data?.sessionProbe || {};
  const accountLoad = data?.accountLoad || {};
  const bindings = data?.sessionBindings || {};

  const totalRequests = probe.totalRequests || 0;

  // Merge the two views of per-account state (in-flight load + bound sessions)
  // into one table so an account's concurrency and affinity share are visible
  // side by side.
  const accountRows = useMemo(() => {
    const byConnection = bindings.byConnection || {};
    const ids = new Set([...Object.keys(accountLoad), ...Object.keys(byConnection)]);
    return [...ids]
      .map((id) => ({
        id,
        load: accountLoad[id] || 0,
        sessions: byConnection[id] || 0,
      }))
      .sort((a, b) => b.sessions - a.sessions || b.load - a.load);
  }, [accountLoad, bindings.byConnection]);

  const maxPerAccount = Number(settings.maxSessionsPerAccount) || 0;
  const maxConcurrent = Number(settings.maxConcurrentPerAccount) || 0;

  const clientHitRate = totalRequests > 0 ? (probe.levelHits?.client?.count || 0) / totalRequests : null;

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-main">Scheduling Diagnostics</h1>
          <p className="text-sm text-text-muted">
            Read-only view of session affinity, per-account load and identity resolution.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={autoRefresh ? "success" : "default"} dot>
            {autoRefresh ? `Auto ${REFRESH_MS / 1000}s` : "Paused"}
          </Badge>
          <Button size="sm" variant="outline" icon="refresh" onClick={load}>
            Refresh
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={autoRefresh ? "pause" : "play_arrow"}
            onClick={() => setAutoRefresh((v) => !v)}
          >
            {autoRefresh ? "Pause" : "Resume"}
          </Button>
        </div>
      </div>

      {error ? (
        <Card padding="sm" className="border-red-500/40">
          <div className="flex items-center gap-2 text-sm text-red-500">
            <span className="material-symbols-outlined text-[18px]">error</span>
            {error}
          </div>
        </Card>
      ) : null}

      {/* Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          icon="route"
          label="Scheduling mode"
          value={settings.schedulingMode || "fill-first"}
          sub={settings.sessionBindingEnabled ? "Session affinity ON" : "Session affinity OFF"}
          tone="info"
        />
        <StatTile
          icon="hub"
          label="Bound sessions"
          value={bindings.totalSessions ?? 0}
          sub={`across ${bindings.connections ?? 0} account(s)`}
          tone="success"
        />
        <StatTile
          icon="speed"
          label="In-flight requests"
          value={Object.values(accountLoad).reduce((a, b) => a + b, 0)}
          sub={
            maxConcurrent > 0
              ? `ceiling ${maxConcurrent} / account`
              : "concurrency gate disabled"
          }
          tone="warning"
        />
        <StatTile
          icon="fingerprint"
          label="Client-id hit rate"
          value={clientHitRate === null ? "–" : pct(clientHitRate)}
          sub={`${totalRequests} request(s) probed`}
          tone={clientHitRate !== null && clientHitRate >= 0.5 ? "success" : "warning"}
        />
      </div>

      {/* Identity resolution */}
      <Card
        title="Session Identity Resolution"
        subtitle="Which level of the resolver matched — higher is more stable for affinity"
        icon="fingerprint"
        action={
          <Button
            size="sm"
            variant={probe.enabled ? "outline" : "primary"}
            loading={busy === "enable-probe" || busy === "disable-probe"}
            onClick={() => action(probe.enabled ? "disable-probe" : "enable-probe")}
          >
            {probe.enabled ? "Disable probe" : "Enable probe"}
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
            <span>
              Probe:{" "}
              <span className={probe.enabled ? "text-green-500 font-medium" : "text-text-muted"}>
                {probe.enabled ? "enabled" : "disabled"}
              </span>
            </span>
            <span>Uptime: {Math.round((probe.uptimeMs || 0) / 1000)}s</span>
            <span>Window: {Math.round((probe.windowMs || 0) / 60000)}m</span>
            <span>Requests: {totalRequests}</span>
          </div>

          {clientHitRate === 0 && totalRequests > 0 ? (
            <div className="p-3 rounded-[10px] bg-amber-500/10 border border-amber-500/30 text-xs text-amber-600 dark:text-amber-400">
              No request resolved to the <b>client</b> level. The client is not sending a stable
              session id (<code>conversation_id</code> / <code>prompt_cache_key</code>), so affinity
              is falling back to weaker signals and each conversation&apos;s first turn may land on a
              different account.
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            {LEVEL_META.map((lvl) => (
              <BarRow
                key={lvl.key}
                label={lvl.label}
                hint={lvl.hint}
                count={probe.levelHits?.[lvl.key]?.count || 0}
                total={totalRequests}
                tone={lvl.tone}
              />
            ))}
          </div>
        </div>
      </Card>

      {/* Candidate recurrence */}
      <Card
        title="Identity Candidate Stability"
        subtitle="How often each alternative key recurred inside the probe window (30m)"
        icon="graphic_eq"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted border-b border-border-subtle">
                <th className="py-2 pr-4 font-medium">Candidate key</th>
                <th className="py-2 pr-4 font-medium text-right">Seen</th>
                <th className="py-2 pr-4 font-medium text-right">Recurring</th>
                <th className="py-2 pr-4 font-medium text-right">Recurrence rate</th>
                <th className="py-2 font-medium text-right">Distinct</th>
              </tr>
            </thead>
            <tbody>
              {CANDIDATE_META.map((c) => {
                const row = probe.candidateRecurrence?.[c.key] || {};
                const rate = row.rate;
                const good = rate !== null && rate !== undefined && rate >= 0.5;
                return (
                  <tr key={c.key} className="border-b border-border-subtle last:border-b-0">
                    <td className="py-2 pr-4 text-text-main">{c.label}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-text-muted">{row.seen ?? 0}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-text-muted">{row.recurring ?? 0}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      <span className={cn("font-medium", good ? "text-green-500" : "text-text-muted")}>
                        {pct(rate)}
                      </span>
                    </td>
                    <td className="py-2 text-right tabular-nums text-text-muted">{row.distinct ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Per-account state */}
      <Card
        title="Per-Account State"
        subtitle={`In-flight requests and bound sessions per upstream account`}
        icon="dns"
        action={
          <Button
            size="sm"
            variant="outline"
            loading={busy === "reset-load"}
            onClick={() => action("reset-load")}
          >
            Reset load counters
          </Button>
        }
      >
        {accountRows.length === 0 ? (
          <p className="text-sm text-text-muted py-4 text-center">
            No accounts are currently loaded or bound. Send a request to populate this view.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-text-muted border-b border-border-subtle">
                  <th className="py-2 pr-4 font-medium">Account</th>
                  <th className="py-2 pr-4 font-medium">In-flight</th>
                  <th className="py-2 pr-4 font-medium">Bound sessions</th>
                </tr>
              </thead>
              <tbody>
                {accountRows.map((row) => {
                  const loadRatio = maxConcurrent > 0 ? row.load / maxConcurrent : 0;
                  const sessionRatio = maxPerAccount > 0 ? row.sessions / maxPerAccount : 0;
                  return (
                    <tr key={row.id} className="border-b border-border-subtle last:border-b-0">
                      <td className="py-2 pr-4 font-mono text-xs text-text-main">{shortId(row.id)}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums text-text-main w-10">
                            {row.load}
                            {maxConcurrent > 0 ? <span className="text-text-muted">/{maxConcurrent}</span> : null}
                          </span>
                          {maxConcurrent > 0 ? (
                            <div className="h-1.5 w-20 rounded-full bg-surface-2 overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  loadRatio >= 1 ? "bg-red-500" : "bg-blue-500"
                                )}
                                style={{ width: `${Math.min(loadRatio * 100, 100)}%` }}
                              />
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="tabular-nums text-text-main w-10">
                            {row.sessions}
                            {maxPerAccount > 0 ? <span className="text-text-muted">/{maxPerAccount}</span> : null}
                          </span>
                          {maxPerAccount > 0 ? (
                            <div className="h-1.5 w-20 rounded-full bg-surface-2 overflow-hidden">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  sessionRatio >= 1 ? "bg-amber-500" : "bg-green-500"
                                )}
                                style={{ width: `${Math.min(sessionRatio * 100, 100)}%` }}
                              />
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Effective settings */}
      <Card title="Effective Scheduling Settings" subtitle="Values currently applied at runtime" icon="tune">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          {[
            ["Scheduling mode", settings.schedulingMode],
            ["Session affinity", settings.sessionBindingEnabled ? "on" : "off"],
            ["Max sessions / account", settings.maxSessionsPerAccount],
            ["Overflow policy", settings.sessionOverflowPolicy],
            ["Idle TTL", settings.sessionIdleTtlMs ? `${Math.round(settings.sessionIdleTtlMs / 60000)} min` : "–"],
            ["Max concurrent / account", settings.maxConcurrentPerAccount],
            ["Prefer earlier expiry", settings.quotaPreferEarlierExpiry ? "on" : "off"],
            ["Quota weight (remaining)", settings.quotaWeightRemaining],
            ["Quota weight (expiry)", settings.quotaWeightExpiry],
            ["Probe enabled", settings.sessionProbeEnabled ? "on" : "off"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 py-1.5 border-b border-border-subtle last:border-b-0"
            >
              <span className="text-text-muted">{label}</span>
              <span className="text-text-main font-medium tabular-nums">{String(value ?? "–")}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-text-muted mt-4">
          Change these in <a className="text-brand-500 hover:underline" href="/dashboard/profile">Settings → Session Affinity &amp; Scheduling</a>.
        </p>
      </Card>

      <p className="text-xs text-text-muted text-center pb-2">
        {lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString()}` : "Not loaded yet"}
        {autoRefresh ? ` · refreshing every ${REFRESH_MS / 1000}s` : ""}
      </p>
    </div>
  );
}
