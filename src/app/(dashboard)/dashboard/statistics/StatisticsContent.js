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

  // Auto refresh: interval refetch via a cache-buster tick in buildUrl.
  const [autoRefresh, setAutoRefresh] = useState("off");
  const [refreshTick, setRefreshTick] = useState(0);

  // Aggregated breakdown panel (collapsible, between cards and trend chart).
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownMode, setBreakdownMode] = useState("provider"); // provider | model
  const [expanded, setExpanded] = useState(() => new Set());

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
    params.set("_", String(refreshTick));
    return `/api/usage/statistics?${params.toString()}`;
  }, [provider, account, model, range, page, pageSize, refreshTick]);

  // One manual/interval refresh: flip loading immediately (event-context, not
  // effect body) and bump the cache-buster tick that buildUrl includes.
  const refreshNow = useCallback(() => {
    setLoading(true);
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (autoRefresh === "off") return;
    const ms = Number(autoRefresh) * 1000;
    const id = setInterval(refreshNow, ms);
    return () => clearInterval(id);
  }, [autoRefresh, refreshNow]);

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

  const accountNameMap = useMemo(() => {
    const map = {};
    for (const a of filters.accounts || []) map[a.id] = a.name;
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
          <div className="ml-auto flex items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-text-main">自动刷新</span>
              <select
                value={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.value)}
                className="h-9 rounded-lg border border-border bg-surface-2 px-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30 cursor-pointer"
              >
                <option value="off">关闭</option>
                <option value="5">5s</option>
                <option value="10">10s</option>
                <option value="30">30s</option>
                <option value="60">60s</option>
              </select>
            </div>
            <button
              onClick={refreshNow}
              className="h-9 px-3 rounded-lg border border-border bg-surface-2 text-sm font-medium text-text-main hover:bg-surface hover:border-brand-400 transition-colors cursor-pointer whitespace-nowrap"
            >
              立刻刷新
            </button>
          </div>
        </div>
      </Card>

      {/* Summary cards (cache R/W and latency pair merged into A/B cards) +
          toggle tile for the aggregated breakdown panel below. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Requests" value={loading ? "…" : String(summary?.totalRequests ?? 0)} />
        <StatCard label="Total Tokens" value={loading ? "…" : fmtTokens(summary?.totalTokens)} />
        <StatCard label="Input Tokens" value={loading ? "…" : fmtTokens(summary?.inputTokens)} />
        <StatCard label="Output Tokens" value={loading ? "…" : fmtTokens(summary?.outputTokens)} />
        <StatCard label="Cache Read/Write" value={loading ? "…" : `${fmtTokens(summary?.cacheReadTokens)} / ${fmtTokens(summary?.cacheCreationTokens)}`} />
        <StatCard label="Cache Hit Rate" value={loading ? "…" : fmtPct(summary?.cacheHitRate)} />
        <StatCard label="Response/TTFT" value={loading ? "…" : fmtLatencyPair(summary?.latency?.avgLatencyMs, summary?.latency?.avgTtftMs)} />
        <button
          onClick={() => setBreakdownOpen((o) => !o)}
          className={`rounded-[14px] border border-dashed p-4 flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer min-h-[76px] ${
            breakdownOpen
              ? "border-brand-400 bg-brand-500/10 text-primary"
              : "border-border bg-surface text-text-muted hover:text-primary hover:border-brand-400"
          }`}
        >
          <span className="material-symbols-outlined">{breakdownOpen ? "unfold_less" : "unfold_more"}</span>
          <span className="text-xs font-medium whitespace-nowrap">聚合明细</span>
        </button>
      </div>

      {/* Aggregated breakdown — animated collapse between cards and chart */}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 ease-out"
        style={{ gridTemplateRows: breakdownOpen ? "1fr" : "0fr", opacity: breakdownOpen ? 1 : 0 }}
      >
        <div className="overflow-hidden min-h-0">
          <BreakdownTable
            rows={data?.breakdown || []}
            mode={breakdownMode}
            onModeChange={(m) => { setBreakdownMode(m); setExpanded(new Set()); }}
            providerNames={providerNameMap}
            accountNames={accountNameMap}
            expanded={expanded}
            onToggle={(key) =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              })
            }
          />
        </div>
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

// ---- Aggregated breakdown (provider⇄model drill-down) ---------------------

// Sum raw grain rows into one accumulator.
function rollupRows(rows) {
  const a = { requests: 0, prompt: 0, completion: 0, cached: 0, created: 0, lat: 0, ttft: 0 };
  for (const r of rows) {
    a.requests += r.requests || 0;
    a.prompt += r.promptTokens || 0;
    a.completion += r.completionTokens || 0;
    a.cached += r.cachedTokens || 0;
    a.created += r.cacheCreationTokens || 0;
    a.lat += r.latencySum || 0;
    a.ttft += r.ttftSum || 0;
  }
  return a;
}

// Accumulator → display metrics (same formulas as the summary cards).
function toMetrics(a) {
  const inputOnly = Math.max(0, a.prompt - a.cached - a.created);
  const denom = inputOnly + a.cached;
  return {
    requests: a.requests,
    totalTokens: a.prompt + a.completion,
    inputTokens: inputOnly,
    outputTokens: a.completion,
    cacheRead: a.cached,
    cacheWrite: a.created,
    hitRate: denom > 0 ? a.cached / denom : 0,
    avgLatency: a.requests ? a.lat / a.requests : 0,
    avgTtft: a.requests ? a.ttft / a.requests : 0,
  };
}

// Finest grain → tree per mode:
//   provider: provider → account → model
//   model:    model → provider → account
function buildTree(rows, mode, providerNames, accountNames) {
  const group = (list, fn) => {
    const m = new Map();
    for (const r of list) {
      const k = fn(r) || "-";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };
  const agg = (list) => toMetrics(rollupRows(list));
  const sortByRequests = (nodes) => nodes.sort((x, y) => y.metrics.requests - x.metrics.requests);

  if (mode === "provider") {
    const mkAccounts = (list) =>
      sortByRequests([...group(list, (r) => r.connectionId).entries()].map(([conn, rs]) => ({
        key: `conn:${conn}`,
        label: accountNames[conn] || conn || "-",
        metrics: agg(rs),
        children: sortByRequests([...group(rs, (r) => r.model).entries()].map(([model, rs2]) => ({
          key: `conn:${conn}/model:${model}`,
          label: model,
          metrics: agg(rs2),
          children: [],
        }))),
      })));
    return sortByRequests([...group(rows, (r) => r.provider).entries()].map(([p, rs]) => ({
      key: `prov:${p}`,
      label: providerNames[p] || p,
      metrics: agg(rs),
      children: mkAccounts(rs),
    })));
  }

  const mkProviders = (list) =>
    sortByRequests([...group(list, (r) => r.provider).entries()].map(([p, rs]) => ({
      key: `prov:${p}`,
      label: providerNames[p] || p,
      metrics: agg(rs),
      children: sortByRequests([...group(rs, (r) => r.connectionId).entries()].map(([conn, rs2]) => ({
        key: `prov:${p}/conn:${conn}`,
        label: accountNames[conn] || conn || "-",
        metrics: agg(rs2),
        children: [],
      }))),
    })));
  return sortByRequests([...group(rows, (r) => r.model).entries()].map(([model, rs]) => ({
    key: `model:${model}`,
    label: model,
    metrics: agg(rs),
    children: mkProviders(rs),
  })));
}

// Level tinting: L1 transparent, L2 faint, L3 stronger — one hue so nesting
// depth is readable at a glance; hover deepens the current tint.
const DEPTH_STYLES = [
  "hover:bg-brand-500/5",
  "bg-brand-500/5 hover:bg-brand-500/10",
  "bg-brand-500/10 hover:bg-brand-500/15",
];

const TREE_COLS = ["请求数", "总 Token", "输入", "输出", "缓存读", "缓存写", "命中率", "用时/首字"];

function BreakdownTable({ rows, mode, onModeChange, providerNames, accountNames, expanded, onToggle }) {
  const tree = useMemo(
    () => buildTree(rows, mode, providerNames, accountNames),
    [rows, mode, providerNames, accountNames]
  );

  return (
    <Card padding="none" className="min-w-0">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle">
        <span className="text-sm font-semibold text-text-main">聚合明细</span>
        <SegmentedControl
          size="sm"
          options={[
            { value: "provider", label: "按提供商" },
            { value: "model", label: "按模型" },
          ]}
          value={mode}
          onChange={onModeChange}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
              <th className="pl-4 pr-2 py-2.5 font-medium">维度</th>
              {TREE_COLS.map((h) => (
                <th key={h} className="px-2 py-2.5 font-medium text-right whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tree.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-text-muted">没有匹配的数据。</td></tr>
            )}
            {tree.map((n) => (
              <BreakdownNode key={n.key} node={n} depth={0} expanded={expanded} onToggle={onToggle} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function BreakdownNode({ node, depth, expanded, onToggle }) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.key);
  const pad = { paddingLeft: `${16 + depth * 20}px` };
  return (
    <>
      <tr
        onClick={() => hasChildren && onToggle(node.key)}
        className={`${DEPTH_STYLES[depth] || DEPTH_STYLES[2]} border-b border-border-subtle last:border-b-0 ${hasChildren ? "cursor-pointer" : ""}`}
      >
        <td className="py-2 pr-2 whitespace-nowrap" style={pad}>
          <span className="inline-flex items-center gap-1">
            {hasChildren ? (
              <span
                className={`material-symbols-outlined text-sm text-text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
              >
                expand_more
              </span>
            ) : (
              <span className="w-4" />
            )}
            <span className={depth === 0 ? "font-medium text-text-main" : "text-text-muted"}>{node.label}</span>
          </span>
</td>
        {TREE_COLS.map((h, i) => (
          <td key={h} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
            {i === 0
              ? String(node.metrics.requests)
              : i === 1
                ? fmtTokens(node.metrics.totalTokens)
                : i === 2
                  ? fmtTokens(node.metrics.inputTokens)
                  : i === 3
                    ? fmtTokens(node.metrics.outputTokens)
                    : i === 4
                      ? fmtTokens(node.metrics.cacheRead)
                      : i === 5
                        ? fmtTokens(node.metrics.cacheWrite)
                        : i === 6
                          ? fmtPct(node.metrics.hitRate)
                          : fmtLatencyPair(node.metrics.avgLatency, node.metrics.avgTtft)}
          </td>
        ))}
      </tr>
      {isOpen && node.children.map((c) => (
        <BreakdownNode key={c.key} node={c} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
      ))}
    </>
  );
}
