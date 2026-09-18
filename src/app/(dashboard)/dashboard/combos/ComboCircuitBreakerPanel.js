"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/shared/components";

function humanizeReason(reason) {
  if (!reason) return "Unknown failure";
  return reason.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatWhen(value) {
  if (!value) return "—";
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms)) return value;
  if (ms <= 0) return "Ready for recovery probe";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `in ${seconds}s`;
  return `in ${Math.ceil(seconds / 60)}m`;
}

function StateBadge({ state }) {
  const label = state === "half-open" ? "Half-open" : "Open";
  const classes = state === "half-open"
    ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
    : "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400";

  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${classes}`}>
      {label}
    </span>
  );
}

export default function ComboCircuitBreakerPanel() {
  const [circuits, setCircuits] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(null);
  const [message, setMessage] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/combos/circuit-breaker", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setCircuits(Array.isArray(data.circuits) ? data.circuits : []);
      setConfig(data.config || null);
    } catch {
      // Keep the panel passive if the endpoint is temporarily unavailable.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  const testNow = async (model) => {
    setTesting(model);
    setMessage(null);
    try {
      const response = await fetch("/api/combos/circuit-breaker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        setMessage({ type: "success", text: `${model} passed the recovery probe and was released.` });
      } else {
        setMessage({ type: "error", text: `${model} failed the recovery probe: ${data.error || "unknown error"}` });
      }
      await refresh();
    } catch (error) {
      setMessage({ type: "error", text: error?.message || "Recovery probe failed" });
    } finally {
      setTesting(null);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px] text-primary">electric_bolt</span>
              <h2 className="font-semibold text-text-main">Combo Circuit Breaker</h2>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              Unhealthy combo models are quarantined and skipped until a recovery probe succeeds.
            </p>
          </div>
          {config && (
            <div className="text-xs text-text-muted sm:text-right">
              <div>{config.failureThreshold} consecutive failures</div>
              <div>{Math.round(config.slowResponseThresholdMs / 1000)}s latency threshold</div>
            </div>
          )}
        </div>

        {message && (
          <div className={`rounded-lg border px-3 py-2 text-sm ${
            message.type === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
          }`}>
            {message.text}
          </div>
        )}

        {loading ? (
          <div className="text-sm text-text-muted">Loading circuit state…</div>
        ) : circuits.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-text-muted">
            No combo models are quarantined.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-black/[0.025] text-xs text-text-muted dark:bg-white/[0.025]">
                <tr>
                  <th className="px-3 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Failures</th>
                  <th className="px-3 py-2 font-medium">Last latency</th>
                  <th className="px-3 py-2 font-medium">Next recovery probe</th>
                  <th className="px-3 py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {circuits.map((entry) => (
                  <tr key={entry.model}>
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs text-text-main">{entry.model}</code>
                    </td>
                    <td className="px-3 py-2"><StateBadge state={entry.state} /></td>
                    <td className="px-3 py-2 text-xs text-text-muted">{humanizeReason(entry.lastReason)}</td>
                    <td className="px-3 py-2 text-xs text-text-muted">{entry.consecutiveFailures}</td>
                    <td className="px-3 py-2 text-xs text-text-muted">
                      {Number.isFinite(entry.lastLatencyMs) ? `${entry.lastLatencyMs} ms` : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted">{formatWhen(entry.nextProbeAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={testing === entry.model || entry.state === "half-open"}
                        onClick={() => testNow(entry.model)}
                        className="inline-flex items-center gap-1 rounded-lg border border-primary/30 px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[15px]">network_check</span>
                        {testing === entry.model ? "Testing…" : "Test now"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
