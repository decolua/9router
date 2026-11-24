"use client";

// Per-API-key usage report: totals, budget meters, daily cost, by-model table.
import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Modal, Button } from "@/shared/components";
import KeyBudgetMeters from "./KeyBudgetMeters";

const RANGES = [7, 30, 90];
const COST_COLOR = "#f59e0b"; // same cost color as the Usage page chart

const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n || 0));
const fmtCost = (n) => `$${(n || 0).toFixed(n >= 100 ? 2 : 4)}`;
const fmtDay = (iso) => new Date(`${iso}T00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-border bg-bg-subtle px-3 py-2">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-text-main">{value}</p>
    </div>
  );
}

export default function KeyUsageModal({ apiKey, onClose, onEditLimits }) {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/keys/${apiKey.id}/usage?days=${days}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => { if (!cancelled) { setReport(data); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [apiKey.id, days]);

  const loading = !report && !error;
  const hasCost = report?.daily.some((d) => d.cost > 0);

  return (
    <Modal isOpen onClose={onClose} title={`Usage · ${apiKey.name}`} size="xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-bg-subtle p-1" role="tablist" aria-label="Range">
            {RANGES.map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={days === d}
                onClick={() => setDays(d)}
                className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${days === d ? "bg-primary text-white shadow-sm" : "text-text-muted hover:bg-bg-hover hover:text-text"}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" icon="tune" onClick={onEditLimits}>Edit limits</Button>
        </div>

        {error && <p className="text-sm text-red-500">Failed to load usage: {error}</p>}
        {loading && <div className="flex h-48 items-center justify-center text-sm text-text-muted">Loading…</div>}

        {report && (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Requests" value={report.totals.requests.toLocaleString()} />
              <Stat label="Tokens" value={fmtTokens(report.totals.promptTokens + report.totals.completionTokens)} />
              <Stat label="Cost" value={fmtCost(report.totals.cost)} />
            </div>

            <KeyBudgetMeters apiKey={apiKey} spend={report.spend} />

            <div>
              <p className="mb-1 text-sm font-medium text-text-main">Daily cost</p>
              {hasCost ? (
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={report.daily} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradKeyCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COST_COLOR} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={COST_COLOR} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} vertical={false} />
                    <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} width={50} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }}
                      labelFormatter={fmtDay}
                      formatter={(v, _n, item) => [`${fmtCost(v)} · ${item.payload.requests} req`, "Cost"]}
                    />
                    <Area type="monotone" dataKey="cost" stroke={COST_COLOR} strokeWidth={2} fill="url(#gradKeyCost)" dot={false} activeDot={{ r: 4 }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-sm text-text-muted">
                  No cost recorded in the last {days} days
                </div>
              )}
            </div>

            <div>
              <p className="mb-1 text-sm font-medium text-text-main">By model</p>
              {report.byModel.length === 0 ? (
                <p className="text-sm text-text-muted">No requests in this range.</p>
              ) : (
                <div className="max-h-64 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-bg-subtle text-left text-text-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Model</th>
                        <th className="px-3 py-2 text-right font-medium">Requests</th>
                        <th className="px-3 py-2 text-right font-medium">In</th>
                        <th className="px-3 py-2 text-right font-medium">Out</th>
                        <th className="px-3 py-2 text-right font-medium">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.byModel.map((m) => (
                        <tr key={`${m.provider}/${m.model}`} className="border-t border-border">
                          <td className="px-3 py-2">
                            <span className="font-mono text-text-main">{m.model}</span>
                            <span className="ml-1 text-text-muted">{m.provider}</span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{m.requests.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtTokens(m.promptTokens)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtTokens(m.completionTokens)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-text-main">{fmtCost(m.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

KeyUsageModal.propTypes = {
  apiKey: PropTypes.shape({ id: PropTypes.string.isRequired, name: PropTypes.string }).isRequired,
  onClose: PropTypes.func.isRequired,
  onEditLimits: PropTypes.func.isRequired,
};
