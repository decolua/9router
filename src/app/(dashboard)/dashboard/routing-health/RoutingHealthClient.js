"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, Button, Input, Toggle, ConfirmModal } from "@/shared/components";

const REFRESH_MS = 5000;

// Tuning fields rendered in the config card, in display order.
const CONFIG_FIELDS = [
  { key: "windowSize", label: "Window Size", hint: "Recent calls kept per account", min: 5, max: 200, step: 1 },
  { key: "minSamples", label: "Min Samples", hint: "Calls before an account can be ranked", min: 1, max: 50, step: 1 },
  { key: "latencyWeight", label: "Latency Weight", hint: "How much speed matters (0-1)", min: 0, max: 1, step: 0.05 },
  { key: "errorWeight", label: "Error Weight", hint: "How much failures matter (0-1)", min: 0, max: 1, step: 0.05 },
  { key: "latencyToleranceRatio", label: "Latency Tolerance", hint: "1.0 = 2x slower than best is fully penalized", min: 0.1, max: 10, step: 0.1 },
  { key: "explorationRate", label: "Exploration Rate", hint: "Chance to retry a non-best account", min: 0, max: 1, step: 0.05 },
  { key: "circuitErrorRate", label: "Circuit Error Rate", hint: "Error rate that trips the breaker", min: 0.1, max: 1, step: 0.05 },
  { key: "circuitMinSamples", label: "Circuit Min Samples", hint: "Calls needed before tripping", min: 2, max: 100, step: 1 },
  { key: "circuitCooldownMs", label: "Circuit Cooldown (ms)", hint: "How long a tripped account is skipped", min: 1000, max: 1800000, step: 1000 },
  { key: "sampleTtlMs", label: "Sample TTL (ms)", hint: "Age after which samples are ignored", min: 60000, max: 86400000, step: 60000 },
];

function formatMs(ms) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatAgo(ts) {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 1000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function healthTone(row) {
  if (row.circuitOpen) return { label: "Circuit Open", cls: "bg-red-500/10 text-red-500" };
  if (row.errorRate >= 0.2) return { label: "Degraded", cls: "bg-amber-500/10 text-amber-500" };
  return { label: "Healthy", cls: "bg-emerald-500/10 text-emerald-500" };
}

/** Horizontal bar comparing a value against the worst value in the table. */
function Meter({ value, max, tone = "bg-brand-500" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-bg overflow-hidden">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function RoutingHealthClient() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draftConfig, setDraftConfig] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState("");
  const dirtyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/routing-health");
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      // Don't clobber values the user is currently editing.
      if (!dirtyRef.current) setDraftConfig(json.config);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load routing health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const toggleStrategy = async (enabled) => {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fallbackStrategy: enabled ? "latency-aware" : "fill-first" }),
      });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = (key, value) => {
    dirtyRef.current = true;
    setDraftConfig((prev) => ({ ...prev, [key]: value }));
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const payload = {};
      for (const { key } of CONFIG_FIELDS) {
        const raw = draftConfig?.[key];
        if (raw === "" || raw === undefined || raw === null) continue;
        payload[key] = Number(raw);
      }
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latencyAwareConfig: payload }),
      });
      dirtyRef.current = false;
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const resetStats = async () => {
    setConfirmReset(false);
    await fetch("/api/routing-health", { method: "DELETE" });
    await load();
  };

  const stats = data?.stats || [];
  const accountRows = stats.filter((r) => !r.model);
  const modelRows = stats.filter((r) => r.model);
  const maxLatency = Math.max(1, ...stats.map((r) => r.avgLatencyMs));
  const active = data?.latencyAwareActive;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">Routing Health</h1>
        <p className="text-sm text-text-muted mt-1">
          Live latency and error rate per account. When latency-aware routing is on, the router
          prefers the fastest healthy account and skips ones that are currently failing.
        </p>
      </div>

      {error && (
        <div className="px-4 py-3 rounded-[10px] bg-red-500/10 text-red-500 text-sm">{error}</div>
      )}

      {/* Strategy switch */}
      <Card>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 shrink-0">
            <span className="material-symbols-outlined text-[20px]">speed</span>
          </div>
          <h3 className="text-base sm:text-lg font-semibold">Latency-Aware Routing</h3>
        </div>
        <div className="flex items-start sm:items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm sm:text-base">Enable globally</p>
            <p className="text-xs sm:text-sm text-text-muted">
              Replaces Fill First / Round Robin as the default account picker for every provider.
            </p>
          </div>
          <Toggle checked={!!active} onChange={() => toggleStrategy(!active)} disabled={saving || loading} />
        </div>
        <p className="text-xs text-text-muted italic pt-3 mt-3 border-t border-border-subtle">
          {active
            ? "Active — accounts are ranked by live latency and error rate."
            : `Inactive — currently using "${data?.globalStrategy || "fill-first"}".`}
          {data?.perProviderEnabled?.length > 0 &&
            ` Per-provider override active on: ${data.perProviderEnabled.join(", ")}.`}
        </p>
      </Card>

      {/* Tuning */}
      <Card>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500 shrink-0">
              <span className="material-symbols-outlined text-[20px]">tune</span>
            </div>
            <h3 className="text-base sm:text-lg font-semibold">Tuning</h3>
          </div>
          <Button size="sm" onClick={saveConfig} disabled={saving || loading}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CONFIG_FIELDS.map((f) => (
            <Input
              key={f.key}
              label={f.label}
              hint={f.hint}
              type="number"
              min={f.min}
              max={f.max}
              step={f.step}
              value={draftConfig?.[f.key] ?? ""}
              onChange={(e) => updateDraft(f.key, e.target.value)}
              disabled={loading}
            />
          ))}
        </div>
      </Card>

      {/* Stats */}
      <Card>
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 shrink-0">
              <span className="material-symbols-outlined text-[20px]">monitoring</span>
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-semibold">Live Stats</h3>
              <p className="text-xs text-text-muted">Refreshes every {REFRESH_MS / 1000}s</p>
            </div>
          </div>
          <Button size="sm" variant="secondary" icon="delete" onClick={() => setConfirmReset(true)} disabled={stats.length === 0}>
            Reset
          </Button>
        </div>

        {loading && stats.length === 0 ? (
          <p className="text-sm text-text-muted py-6 text-center">Loading…</p>
        ) : stats.length === 0 ? (
          <div className="py-10 text-center">
            <span className="material-symbols-outlined text-[40px] text-text-muted">timeline</span>
            <p className="text-sm text-text-muted mt-2">
              No samples yet. Stats appear after the gateway handles a few requests.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <StatsTable title="Per Account" rows={accountRows} maxLatency={maxLatency} />
            {modelRows.length > 0 && (
              <StatsTable title="Per Account + Model" rows={modelRows} maxLatency={maxLatency} showModel />
            )}
          </div>
        )}
      </Card>

      <ConfirmModal
        isOpen={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={resetStats}
        title="Reset routing health"
        message="Clear all collected latency and error samples? Routing falls back to probing every account until new data arrives."
        confirmText="Reset"
        variant="danger"
      />
    </div>
  );
}

function StatsTable({ title, rows, maxLatency, showModel = false }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-xs text-text-muted border-b border-border-subtle">
              <th className="py-2 pr-3 font-medium">Account</th>
              {showModel && <th className="py-2 pr-3 font-medium">Model</th>}
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Avg Latency</th>
              <th className="py-2 pr-3 font-medium">p95</th>
              <th className="py-2 pr-3 font-medium">Error Rate</th>
              <th className="py-2 pr-3 font-medium">Samples</th>
              <th className="py-2 font-medium">Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tone = healthTone(row);
              return (
                <tr key={`${row.connectionId}-${row.model || "all"}`} className="border-b border-border-subtle last:border-b-0">
                  <td className="py-2.5 pr-3">
                    <div className="font-medium truncate max-w-[180px]">
                      {row.connectionName || row.connectionId.slice(0, 8)}
                    </div>
                    {row.provider && <div className="text-[11px] text-text-muted">{row.provider}</div>}
                  </td>
                  {showModel && (
                    <td className="py-2.5 pr-3 font-mono text-xs truncate max-w-[200px]">{row.model}</td>
                  )}
                  <td className="py-2.5 pr-3">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${tone.cls}`}>
                      {tone.label}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 w-[130px]">
                    <div className="font-mono text-xs mb-1">{formatMs(row.avgLatencyMs)}</div>
                    <Meter value={row.avgLatencyMs} max={maxLatency} />
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-xs">{formatMs(row.p95LatencyMs)}</td>
                  <td className="py-2.5 pr-3 w-[110px]">
                    <div className="font-mono text-xs mb-1">{(row.errorRate * 100).toFixed(0)}%</div>
                    <Meter value={row.errorRate} max={1} tone={row.errorRate >= 0.2 ? "bg-red-500" : "bg-emerald-500"} />
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-xs">
                    {row.successes}/{row.samples}
                  </td>
                  <td className="py-2.5 text-xs text-text-muted">{formatAgo(row.lastSampleAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
