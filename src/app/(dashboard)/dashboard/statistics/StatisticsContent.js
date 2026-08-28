"use client";

import { useState, useEffect, useCallback, useMemo, useReducer } from "react";
import { translate, onLocaleChange } from "@/i18n/runtime";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  
  Legend,
} from "recharts";
import { Card, SegmentedControl, MultiSelect } from "@/shared/components";
import Pagination from "@/shared/components/Pagination";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
];

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtPct = (n) => `${((n || 0) * 100).toFixed(1)}%`;
const fmtDur = (ms) => (ms ? `${(ms / 1000).toFixed(1)}s` : "-");
// "用时/首字" — total latency / time-to-first-token, e.g. 2.6s/0.3s
const fmtLatencyPair = (total, ttft) => {
  if (!total && !ttft) return "-";
  return `${fmtDur(total)}/${fmtDur(ttft)}`;
};

function periodRange(period) {
  const now = new Date();
  switch (period) {
    case "today": {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return { startDate: d.toISOString() };
    }
    case "24h":
      return { startDate: new Date(now.getTime() - 24 * HOUR_MS).toISOString() };
    case "7d":
      return { startDate: new Date(now.getTime() - 7 * DAY_MS).toISOString() };
    case "30d":
      return { startDate: new Date(now.getTime() - 30 * DAY_MS).toISOString() };
    default:
      return {};
  }
}

export default function StatisticsContent({ initialData }) {
  // Re-render on locale switch so explicitly-translated text (table headers,
  // which the runtime i18n skips inside <table>) updates too.
  const [, forceRender] = useReducer((x) => x + 1, 0);
  useEffect(() => onLocaleChange(forceRender), []);
  const t = translate;

  const [period, setPeriod] = useState("all");
  const [provider, setProvider] = useState([]);
  const [account, setAccount] = useState([]);
  const [model, setModel] = useState([]);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [customRange, setCustomRange] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Initial payload rendered server-side (see page.js): real numbers on first
  // paint; refetches keep the previous values visible instead of "…".
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState("tokens");

  const range = useMemo(() => {
    if (period === "custom") return customRange || {};
    return periodRange(period);
  }, [period, customRange]);

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (provider.length) params.set("provider", provider.join(","));
    if (account.length) params.set("connectionId", account.join(","));
    if (model.length) params.set("model", model.join(","));
    if (range.startDate) params.set("startDate", range.startDate);
    if (range.endDate) params.set("endDate", range.endDate);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    return `/api/usage/statistics?${params.toString()}`;
  }, [provider, account, model, range, page, pageSize]);

  useEffect(() => {
    let cancelled = false;
    fetch(buildUrl())
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (!cancelled && json) setData(json); })
      .catch((e) => console.error("Failed to load statistics:", e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [buildUrl]);

  const resetFilters = () => {
    setProvider([]);
    setAccount([]);
    setModel([]);
    setPeriod("all");
    setCustomStart("");
    setCustomEnd("");
    setCustomRange(null);
    setPage(1);
  };

  const applyCustomRange = () => {
    const start = customStart ? new Date(customStart) : null;
    const end = customEnd ? new Date(customEnd) : null;
    if (start && end && start.getTime() > end.getTime()) return;
    setCustomRange({
      startDate: start ? start.toISOString() : undefined,
      endDate: end ? end.toISOString() : undefined,
    });
    setPage(1);
  };

  const filters = data?.filters || { providers: [], accounts: [], models: [] };
  const summary = data?.summary || null;
  const series = data?.series || [];
  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, pageSize, totalItems: 0, totalPages: 0 };

  const providerNameMap = useMemo(() => {
    const map = {};
    for (const p of filters.providers || []) map[p.id] = p.name;
    return map;
  }, [filters]);

  // Cascade: when providers are selected, account/model options narrow to those
  // providers' accounts/models (union across selected providers). No provider
  // selected → all options.
  const accountOptions = useMemo(() => {
    if (provider.length === 0) return (filters.accounts || []).map((a) => ({ value: a.id, label: a.name }));
    const map = new Map();
    for (const p of provider) {
      for (const a of (filters.accountsByProvider || {})[p] || []) map.set(a.id, a.name);
    }
    return [...map].map(([id, name]) => ({ value: id, label: name }));
  }, [filters, provider]);

  const modelOptions = useMemo(() => {
    if (provider.length === 0) return (filters.models || []).map((m) => ({ value: m, label: m }));
    const set = new Set();
    for (const p of provider) {
      for (const m of (filters.modelsByProvider || {})[p] || []) set.add(m);
    }
    return [...set].map((m) => ({ value: m, label: m }));
  }, [filters, provider]);

  const hasFilter = provider.length || account.length || model.length || period !== "all" || customRange;

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Filter bar */}
      <Card padding="md">
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelect
            label="Provider"
            options={filters.providers.map((p) => ({ value: p.id, label: p.name }))}
            value={provider}
            onChange={(v) => {
              setProvider(v);
              // Prune accounts/models that no longer belong to the selected
              // providers (they become invalid under cascade).
              const allowedAcc = new Set(
                v.flatMap((p) => (filters.accountsByProvider || {})[p] || [])
                  .map((a) => a.id)
              );
              const allowedModel = new Set(
                v.flatMap((p) => (filters.modelsByProvider || {})[p] || [])
              );
              if (account.length && !account.every((a) => allowedAcc.has(a)))
                setAccount(account.filter((a) => allowedAcc.has(a)));
              if (model.length && !model.every((m) => allowedModel.has(m)))
                setModel(model.filter((m) => allowedModel.has(m)));
              setPage(1);
            }}
            allLabel="All providers"
            className="w-40"
          />
          <MultiSelect
            label="Account"
            options={accountOptions}
            value={account}
            onChange={(v) => { setAccount(v); setPage(1); }}
            allLabel="All accounts"
            className="w-44"
          />
          <MultiSelect
            label="Model"
            options={modelOptions}
            value={model}
            onChange={(v) => { setModel(v); setPage(1); }}
            allLabel="All models"
            className="w-52"
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-text-main">Period</span>
            <SegmentedControl options={PERIODS} value={period} onChange={(v) => { setPeriod(v); setPage(1); }} size="sm" />
          </div>
          {period === "custom" && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-text-main">Start</span>
                <input
                  type="datetime-local"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-text-main">End</span>
                <input
                  type="datetime-local"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              </div>
              <button
                onClick={applyCustomRange}
                className="h-9 px-4 rounded-lg bg-primary text-white text-sm font-medium transition-colors hover:opacity-90 cursor-pointer"
              >
                Apply
              </button>
            </div>
          )}
          {hasFilter && (
            <button
              onClick={resetFilters}
              className="h-9 px-3 text-sm text-text-muted hover:text-text-main transition-colors cursor-pointer"
            >
              Reset
            </button>
          )}
        </div>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-9">
        <StatCard label="Requests" value={loading ? "…" : String(summary?.totalRequests ?? 0)} />
        <StatCard label="Total Tokens" value={loading ? "…" : fmtTokens(summary?.totalTokens)} />
        <StatCard label="Input Tokens" value={loading ? "…" : fmtTokens(summary?.inputTokens)} />
        <StatCard label="Output Tokens" value={loading ? "…" : fmtTokens(summary?.outputTokens)} />
        <StatCard label="Cache Read" value={loading ? "…" : fmtTokens(summary?.cacheReadTokens)} />
        <StatCard label="Cache Write" value={loading ? "…" : fmtTokens(summary?.cacheCreationTokens)} />
        <StatCard label="Cache Hit Rate" value={loading ? "…" : fmtPct(summary?.cacheHitRate)} />
        <StatCard label="Avg Response" value={loading ? "…" : fmtDur(summary?.latency?.avgLatencyMs)} />
        <StatCard label="Avg TTFT" value={loading ? "…" : fmtDur(summary?.latency?.avgTtftMs)} />
      </div>

      {/* Trend chart */}
      <Card
        padding="md"
        title="Trends"
        action={
          <div className="grid grid-cols-2 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1">
            {["tokens", "hitRate"].map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 rounded-md text-sm font-medium transition-colors cursor-pointer ${viewMode === mode ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text-main"}`}
              >
                {mode === "tokens" ? "Tokens" : "Hit Rate"}
              </button>
            ))}
          </div>
        }
      >
        {loading ? (
          <div className="h-56 flex items-center justify-center text-text-muted text-sm">Loading…</div>
        ) : series.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-text-muted text-sm">No data for this selection</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                {["total", "input", "output", "cacheRead", "cacheCreate", "hitRate"].map((k) => (
                  <linearGradient key={k} id={`grad_${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS[k]} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={COLORS[k]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={viewMode === "tokens" ? fmtTokens : (v) => `${Math.round((v || 0) * 100)}%`}
                domain={viewMode === "tokens" ? [0, "auto"] : [0, 1]}
                width={50}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                formatter={(value, name) => {
                  const label = SERIES_LABELS[name] || name;
                  return viewMode === "tokens"
                    ? [fmtTokens(value), label]
                    : [fmtPct(value), label];
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {viewMode === "tokens" ? (
                <>
                  <Area type="monotone" dataKey="totalTokens" name="Total" stroke={COLORS.total} strokeWidth={2} fill="url(#grad_total)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="inputTokens" name="Input" stroke={COLORS.input} strokeWidth={2} fill="url(#grad_input)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="outputTokens" name="Output" stroke={COLORS.output} strokeWidth={2} fill="url(#grad_output)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="cacheReadTokens" name="Cache Read" stroke={COLORS.cacheRead} strokeWidth={2} fill="url(#grad_cacheRead)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="cacheCreationTokens" name="Cache Write" stroke={COLORS.cacheWrite} strokeWidth={2} fill="url(#grad_cacheWrite)" dot={false} activeDot={{ r: 4 }} />
                </>
              ) : (
                <Area type="monotone" dataKey="cacheHitRate" name="Hit Rate" stroke={COLORS.hitRate} strokeWidth={2} fill="url(#grad_hitRate)" dot={false} activeDot={{ r: 4 }} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Detail table */}
      <Card title="Request Details" padding="none" className="min-w-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
                {["Time", "Provider", "Account", "Model", "Input", "Output", "Cache Read", "Cache Write", "Hit Rate", "Time/TTFT", "Status"].map((h) => (
                  <th key={h} className="px-4 py-2.5 font-medium whitespace-nowrap">{t(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-text-muted">{t("No records for this selection")}</td></tr>
              )}
              {items.map((it) => (
                <tr key={it.id} className="border-b border-border-subtle last:border-b-0 hover:bg-surface-2/50">
                  <td className="px-4 py-2.5 text-text-muted whitespace-nowrap">{fmtTime(it.timestamp)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{providerNameMap[it.provider] || it.provider || "-"}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{it.account || "-"}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{it.model || "-"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtTokens(it.inputTokens)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtTokens(it.outputTokens)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-blue-500">{fmtTokens(it.cacheReadTokens)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-purple-500">{fmtTokens(it.cacheCreationTokens)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmtPct(it.cacheHitRate)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{fmtLatencyPair(it.latencyMs, it.ttftMs)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <StatusBadge status={it.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 border-t border-border-subtle">
          <Pagination
            currentPage={pagination.page}
            pageSize={pagination.pageSize}
            totalItems={pagination.totalItems}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </div>
      </Card>
    </div>
  );
}

const COLORS = {
  total: "#64748b",
  input: "#6366f1",
  output: "#10b981",
  cacheRead: "#3b82f6",
  cacheWrite: "#a855f7",
  hitRate: "#f59e0b",
};

const SERIES_LABELS = {
  totalTokens: "Total",
  inputTokens: "Input",
  outputTokens: "Output",
  cacheReadTokens: "Cache Read",
  cacheCreationTokens: "Cache Write",
  cacheHitRate: "Hit Rate",
};

function StatCard({ label, value }) {
  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface p-4 shadow-[var(--shadow-soft)]">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-text-main truncate">{value}</p>
    </div>
  );
}

function StatusBadge({ status }) {
  const ok = status === "success" || status === "ok" || status === "200 OK";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ok ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-500"
      }`}
    >
      {ok ? "ok" : status || "error"}
    </span>
  );
}

function fmtTime(ts) {
  if (!ts) return "-";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
