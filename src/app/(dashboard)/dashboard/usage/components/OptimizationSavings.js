"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import Card from "@/shared/components/Card";
import { usageScopeQueryString } from "@/lib/auth/usageScope";

const fmt = (n) => new Intl.NumberFormat().format(Math.round(n || 0));
const fmtPct = (n) => `${((n || 0) * 100).toFixed(1)}%`;
const fmtBytes = (n) => {
  const x = n || 0;
  if (x < 1024) return `${x} B`;
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
  return `${(x / (1024 * 1024)).toFixed(2)} MB`;
};
const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;
const fmtTokens = (n) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n || 0));
};

export default function OptimizationSavings({ period, usageScope = "mine" }) {
  const [data, setData] = useState(null);
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const scopeQs = usageScopeQueryString(usageScope);
    Promise.all([
      fetch(`/api/usage/optimization?period=${encodeURIComponent(period)}&${scopeQs}`).then((r) => r.ok ? r.json() : null),
      fetch(`/api/usage/optimization/series?period=${encodeURIComponent(period)}&${scopeQs}`).then((r) => r.ok ? r.json() : null),
    ]).then(([summary, ser]) => {
      if (cancelled) return;
      setData(summary);
      setSeries(ser?.series || []);
      setLoading(false);
    }).catch(() => { if (!cancelled) { setData(null); setSeries([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [period, usageScope]);

  if (loading) {
    return (
      <Card className="px-4 py-3">
        <div className="text-text-muted text-sm">Loading optimization savings…</div>
      </Card>
    );
  }

  if (!data || data.requests === 0) {
    return (
      <Card className="px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined text-primary text-[18px]">savings</span>
          <span className="text-sm font-semibold uppercase text-text-muted">Optimization Savings</span>
        </div>
        <div className="text-sm text-text-muted">
          No data yet for this period. Flip on RTK / Prefix Cache / Compact Policies and run some requests.
        </div>
      </Card>
    );
  }

  const seriesHasData = series.some((s) => s.cacheReadTokens > 0 || s.rtkBytesSaved > 0 || s.dedupBytesSaved > 0 || s.prunedBytes > 0);

  const layerRows = [
    { id: "prefix",  label: "Prefix Cache",        count: data.prefixCacheRequests,    detail: `${fmt(data.cacheReadTokens)} cached input tokens` },
    { id: "rtk",     label: "RTK (tool compress)", count: data.rtkActiveRequests,      detail: `${fmtBytes(data.rtkBytesSaved)} saved` },
    { id: "dedup",   label: "Prompt Dedup",        count: data.dedupActiveRequests || 0, detail: `${fmtBytes(data.dedupBytesSaved || 0)} saved / ${fmt(data.dedupBlocks || 0)} blocks collapsed` },
    { id: "prune",   label: "Context Pruning",     count: data.pruningActiveRequests || 0, detail: `${fmt(data.prunedMessages || 0)} msgs / ${fmtBytes(data.prunedBytes || 0)} elided` },
    { id: "route",   label: "Model Routing",       count: data.routedRequests || 0,    detail: `${fmt(data.routingSimple || 0)} simple→cheap · ${fmt(data.routingComplex || 0)} complex→strong` },
    { id: "caveman", label: "Caveman",             count: data.cavemanRequests,        detail: "Output style compression" },
    { id: "compact", label: "Compact Policies",    count: data.compactPoliciesRequests, detail: "Output behavior rules" },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-primary text-[18px]">savings</span>
        <span className="text-sm font-semibold uppercase text-text-muted">Optimization Savings</span>
      </div>

      {/* Top cards */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 sm:gap-4">
        <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
          <span className="text-text-muted text-xs uppercase font-semibold">Cache Hit Rate</span>
          <span className="truncate text-2xl font-bold text-primary">{fmtPct(data.cacheHitRate)}</span>
          <span className="text-[10px] text-text-muted">{fmt(data.cacheReadTokens)} cached / {fmt(data.cacheReadTokens + data.promptTokens)} input</span>
        </Card>
        <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
          <span className="text-text-muted text-xs uppercase font-semibold">Est. $ Saved (Cache)</span>
          <span className="truncate text-2xl font-bold text-success">~{fmtCost(data.estDollarsSaved)}</span>
          <span className="text-[10px] text-text-muted">vs uncached input rate</span>
        </Card>
        <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
          <span className="text-text-muted text-xs uppercase font-semibold">RTK Bytes Saved</span>
          <span className="truncate text-2xl font-bold text-warning">{fmtBytes(data.rtkBytesSaved)}</span>
          <span className="text-[10px] text-text-muted">{fmt(data.rtkActiveRequests)} / {fmt(data.requests)} requests touched</span>
        </Card>
        <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
          <span className="text-text-muted text-xs uppercase font-semibold">Layers Active</span>
          <div className="flex flex-wrap gap-1 mt-0.5">
            <Pill label="prefix" count={data.prefixCacheRequests} total={data.requests} />
            <Pill label="dedup" count={data.dedupActiveRequests || 0} total={data.requests} />
            <Pill label="prune" count={data.pruningActiveRequests || 0} total={data.requests} />
            <Pill label="route" count={data.routedRequests || 0} total={data.requests} />
            <Pill label="caveman" count={data.cavemanRequests} total={data.requests} />
            <Pill label="compact" count={data.compactPoliciesRequests} total={data.requests} />
          </div>
          <span className="text-[10px] text-text-muted">requests with each layer applied</span>
        </Card>
      </div>

      {/* Time-series chart + per-layer table side-by-side on lg */}
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <Card className="flex min-w-0 flex-col gap-2 p-3 sm:p-4">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Savings over time</span>
          {!seriesHasData ? (
            <div className="h-48 flex items-center justify-center text-text-muted text-sm">No savings yet for this period</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradCacheRead" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradRtk" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} tickFormatter={fmtTokens} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} tickFormatter={fmtBytes} />
                <Tooltip
                  formatter={(value, name) => name === "Cached input tokens" ? fmtTokens(value) : fmtBytes(value)}
                  contentStyle={{ background: "var(--surface, #1f2937)", border: "1px solid var(--border, #374151)", fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area yAxisId="left"  type="monotone" dataKey="cacheReadTokens" name="Cached input tokens" stroke="#6366f1" fill="url(#gradCacheRead)" strokeWidth={2} />
                <Area yAxisId="right" type="monotone" dataKey="rtkBytesSaved"   name="RTK bytes saved"      stroke="#f59e0b" fill="url(#gradRtk)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="flex min-w-0 flex-col p-3 sm:p-4">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Per-layer breakdown</span>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="py-1.5 text-left font-semibold text-text-muted">Layer</th>
                <th className="py-1.5 text-right font-semibold text-text-muted whitespace-nowrap">Requests</th>
                <th className="py-1.5 text-right font-semibold text-text-muted whitespace-nowrap">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {layerRows.map((r) => {
                const pct = data.requests > 0 ? (r.count / data.requests) * 100 : 0;
                return (
                  <tr key={r.id} className="hover:bg-bg-subtle transition-colors">
                    <td className="py-1.5">
                      <div className="font-medium">{r.label}</div>
                      <div className="text-[10px] text-text-muted">{r.detail}</div>
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">{fmt(r.count)}</td>
                    <td className="py-1.5 text-right whitespace-nowrap text-text-muted">{pct.toFixed(0)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

function Pill({ label, count, total }) {
  const active = count > 0;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <span
      className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
        active
          ? "bg-primary/10 text-primary border-primary/30"
          : "bg-transparent text-text-muted border-border"
      }`}
      title={`${count} of ${total} requests (${pct}%)`}
    >
      {label} {active ? `${pct}%` : "—"}
    </span>
  );
}

OptimizationSavings.propTypes = {
  period: PropTypes.string.isRequired,
  usageScope: PropTypes.string,
};
