"use client";

/**
 * ProviderHealthBadge — discreet read-only view over GET /api/health/providers
 * (T3.5, the magro port of OmniRoute's provider health matrix).
 *
 * One file, no redesign: the chip reuses CircuitBreakerBadge's pill classes and
 * the popover reuses ModelAvailabilityBadge's shell and status palette
 * (green/amber/red/grey). There is deliberately NO action in here — no reset,
 * no clear-cooldown, no sync. Recovery stays where it already is
 * (CircuitBreakerBadge's reset button, the availability popover); this component
 * only reads. Polling is 30s, the same cadence ModelAvailabilityBadge uses.
 *
 * `unknown` is a first-class state here: a provider without traffic renders grey
 * with "no traffic observed", never red. That is the "missing data never called
 * paid" rule of the route, kept visible in the UI.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import PropTypes from "prop-types";

const POLL_MS = 30_000;

// Same palette ModelAvailabilityBadge already ships.
const STATUS_CONFIG = {
  ok: { icon: "check_circle", color: "#22c55e", label: "Healthy" },
  cooldown: { icon: "schedule", color: "#f59e0b", label: "Cooldown" },
  degraded: { icon: "warning", color: "#f59e0b", label: "Degraded" },
  down: { icon: "error", color: "#ef4444", label: "Down" },
  unknown: { icon: "help", color: "#6b7280", label: "Unknown" },
};

const CHIP_CLASS = {
  ok: "bg-emerald-500/10 border-emerald-500/20 text-emerald-500",
  cooldown: "bg-amber-500/10 border-amber-500/20 text-amber-500",
  degraded: "bg-amber-500/10 border-amber-500/20 text-amber-500",
  down: "bg-red-500/10 border-red-500/20 text-red-500",
  unknown: "bg-surface border-border text-text-muted",
};

function pct(rate) {
  if (rate === null || rate === undefined) return "—";
  return `${Math.round(rate * 100)}%`;
}

function ms(value) {
  if (!Number.isFinite(value)) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

async function loadMatrix(range) {
  const res = await fetch(`/api/health/providers?range=${encodeURIComponent(range)}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`health providers GET ${res.status}`);
  return res.json();
}

/**
 * @returns {{matrix: object|null, loading: boolean, error: boolean, refresh: () => void}}
 */
export function useProviderHealth(range = "24h") {
  const [matrix, setMatrix] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    loadMatrix(range)
      .then((json) => {
        setMatrix(json);
        setError(false);
        setLoading(false);
      })
      .catch(() => {
        // silent fail — the next tick retries, same as ModelAvailabilityBadge
        setError(true);
        setLoading(false);
      });
  }, [range]);

  useEffect(() => {
    let cancelled = false;
    loadMatrix(range)
      .then((json) => {
        if (cancelled) return;
        setMatrix(json);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  // Fixed 30s cadence, the one ModelAvailabilityBadge already uses: the matrix
  // is cheap and read-only, so there is no "only poll when unhealthy" trick.
  useEffect(() => {
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return { matrix, loading, error, refresh };
}

export default function ProviderHealthBadge({ range = "24h" }) {
  const { matrix, loading, error, refresh } = useProviderHealth(range);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setExpanded(false);
    };
    if (expanded) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  if (loading) return null;

  const providers = matrix?.providers || [];
  const totals = matrix?.totals || {};
  const attention = providers.filter((p) => p.status === "down" || p.status === "degraded" || p.status === "cooldown");
  const summary = error
    ? { key: "unknown", label: "Health unavailable" }
    : providers.length === 0
      ? { key: "unknown", label: "No providers" }
      : attention.length > 0
        ? { key: attention[0].status, label: `${attention.length} provider${attention.length !== 1 ? "s" : ""} to watch` }
        : providers.every((p) => p.status === "unknown")
          ? { key: "unknown", label: "Health unknown" }
          : { key: "ok", label: "Providers healthy" };
  const status = STATUS_CONFIG[summary.key] || STATUS_CONFIG.unknown;
  const chipClass = CHIP_CLASS[summary.key] || CHIP_CLASS.unknown;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setExpanded((v) => !v)}
        title="Provider health (read-only)"
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all ${chipClass}`}
      >
        <span className="material-symbols-outlined text-[14px]" style={{ color: status.color }}>
          {status.icon}
        </span>
        {summary.label}
      </button>

      {expanded && (
        <div className="absolute top-full right-0 mt-2 w-96 bg-surface border border-border rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]" style={{ color: status.color }}>
                {status.icon}
              </span>
              <span className="text-sm font-semibold text-text-main">
                Provider health · last {range}
              </span>
            </div>
            <button
              onClick={refresh}
              className="p-1 rounded-lg hover:bg-surface text-text-muted hover:text-text-main transition-colors"
              title="Refresh"
            >
              <span className="material-symbols-outlined text-[14px]">refresh</span>
            </button>
          </div>

          <div className="px-4 py-3 max-h-80 overflow-y-auto">
            {error ? (
              <p className="text-sm text-text-muted text-center py-2">
                Health data could not be read. Nothing here changes any provider.
              </p>
            ) : providers.length === 0 ? (
              <p className="text-sm text-text-muted text-center py-2">No providers configured.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                <p className="text-[11px] text-text-muted">
                  {totals.requests || 0} requests · {totals.observed || 0} sampled outcomes ·{" "}
                  {totals.unknown || 0} without traffic. Read-only view: no score, no automatic
                  action.
                </p>
                {providers.map((p) => {
                  const cfg = STATUS_CONFIG[p.status] || STATUS_CONFIG.unknown;
                  const models = (p.models || []).slice(0, 6);
                  return (
                    <div key={p.provider} className="rounded-lg bg-surface/30 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="material-symbols-outlined text-[14px] shrink-0"
                            style={{ color: cfg.color }}
                          >
                            {cfg.icon}
                          </span>
                          <span className="font-mono text-xs text-text-main truncate">{p.provider}</span>
                        </div>
                        <span className="text-[10px] text-text-muted shrink-0">
                          {p.requests} req · {pct(p.successRate)} ok · {ms(p.avgLatencyMs)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[10px] text-text-muted">
                        {(p.reasons || []).map((r) => (
                          <span key={r} className="font-mono">{r}</span>
                        ))}
                        {p.breaker && p.breaker.state !== "CLOSED" && (
                          <span className="font-mono text-red-500">
                            breaker {p.breaker.state}
                            {p.breaker.retryAfterMs > 0 ? ` (${Math.ceil(p.breaker.retryAfterMs / 1000)}s)` : ""}
                          </span>
                        )}
                        <span className="font-mono">catalog {p.catalog?.worst || "never-synced"}</span>
                      </div>
                      {models.length > 0 && (
                        <div className="flex flex-col gap-0.5 mt-1.5">
                          {models.map((m) => {
                            const mcfg = STATUS_CONFIG[m.status] || STATUS_CONFIG.unknown;
                            return (
                              <div key={m.model} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="flex items-center gap-1 min-w-0">
                                  <span
                                    className="material-symbols-outlined text-[12px] shrink-0"
                                    style={{ color: mcfg.color }}
                                  >
                                    {mcfg.icon}
                                  </span>
                                  <span className="font-mono text-text-main truncate">{m.model}</span>
                                </span>
                                <span className="text-text-muted shrink-0">
                                  {m.requests} · {pct(m.successRate)} · {ms(m.avgLatencyMs)}
                                </span>
                              </div>
                            );
                          })}
                          {p.modelsTotal > models.length && (
                            <span className="text-[10px] text-text-muted">
                              +{p.modelsTotal - models.length} more models
                            </span>
                          )}
                        </div>
                      )}
                      {models.length === 0 && p.status === "unknown" && (
                        <p className="text-[10px] text-text-muted mt-1">
                          No traffic observed in this window — status is unknown, not down.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

ProviderHealthBadge.propTypes = {
  range: PropTypes.oneOf(["1h", "24h", "7d"]),
};
