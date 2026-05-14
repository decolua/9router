"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import Card from "@/shared/components/Card";
import { cn } from "@/shared/utils/cn";

const PERIODS = ["24h", "7d", "30d", "60d"];
const LS_KEY = "9router_public_api_key";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

const fmtNumber = (n) => (n || 0).toLocaleString("en-US");

function StatCard({ label, value, icon }) {
  return (
    <Card padding="sm" className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-text-muted text-sm">
        {icon && (
          <span className="material-symbols-outlined text-[16px]">{icon}</span>
        )}
        {label}
      </div>
      <div className="text-2xl font-semibold text-text-main">{value}</div>
    </Card>
  );
}

function UsageChartInline({ data, loading }) {
  const [viewMode, setViewMode] = useState("tokens");
  const hasData = data.some((d) => d.tokens > 0 || d.cost > 0);

  return (
    <Card padding="sm" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-main">
          Usage over time
        </span>
        <div className="flex gap-1 rounded-lg border border-border bg-bg-subtle p-1">
          <button
            onClick={() => setViewMode("tokens")}
            className={cn(
              "px-3 py-1 rounded-md text-xs font-medium transition-colors",
              viewMode === "tokens"
                ? "bg-primary text-white shadow-sm"
                : "text-text-muted hover:text-text hover:bg-bg-hover",
            )}
          >
            Tokens
          </button>
          <button
            onClick={() => setViewMode("cost")}
            className={cn(
              "px-3 py-1 rounded-md text-xs font-medium transition-colors",
              viewMode === "cost"
                ? "bg-primary text-white shadow-sm"
                : "text-text-muted hover:text-text hover:bg-bg-hover",
            )}
          >
            Cost
          </button>
        </div>
      </div>

      {loading ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">
          Loading...
        </div>
      ) : !hasData ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">
          No data for this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart
            data={data}
            margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="pubGradTokens" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="pubGradCost" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
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
              tickFormatter={viewMode === "tokens" ? fmtTokens : fmtCost}
              width={50}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              formatter={(value, name) =>
                name === "tokens"
                  ? [fmtTokens(value), "Tokens"]
                  : [fmtCost(value), "Cost"]
              }
            />
            {viewMode === "tokens" ? (
              <Area
                type="monotone"
                dataKey="tokens"
                stroke="#6366f1"
                strokeWidth={2}
                fill="url(#pubGradTokens)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            ) : (
              <Area
                type="monotone"
                dataKey="cost"
                stroke="#f59e0b"
                strokeWidth={2}
                fill="url(#pubGradCost)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function ConnectionInfo({ apiKey }) {
  const [copiedField, setCopiedField] = useState(null);
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const masked = apiKey.length > 12
    ? `${apiKey.slice(0, 8)}${"*".repeat(5)}${apiKey.slice(-3)}`
    : apiKey;

  const copy = (value, field) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  return (
    <Card padding="sm">
      <div className="flex flex-col gap-2 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-text-muted w-16 shrink-0">Base URL</span>
          <code className="font-mono text-text-main bg-bg-subtle px-2 py-0.5 rounded">{baseUrl}</code>
          <button
            onClick={() => copy(baseUrl, "url")}
            className={cn("transition-colors", copiedField === "url" ? "text-green-500" : "text-text-muted hover:text-text-main")}
          >
            <span className="material-symbols-outlined text-[16px]">
              {copiedField === "url" ? "check_circle" : "content_copy"}
            </span>
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-text-muted w-16 shrink-0">API Key</span>
          <code className="font-mono text-text-main bg-bg-subtle px-2 py-0.5 rounded">{masked}</code>
          <button
            onClick={() => copy(apiKey, "key")}
            className={cn("transition-colors", copiedField === "key" ? "text-green-500" : "text-text-muted hover:text-text-main")}
          >
            <span className="material-symbols-outlined text-[16px]">
              {copiedField === "key" ? "check_circle" : "content_copy"}
            </span>
          </button>
        </div>
      </div>
    </Card>
  );
}

function QuotaCard({ quota, loading }) {
  if (loading) {
    return <Card padding="sm" className="h-20 animate-pulse bg-surface" />;
  }
  if (!quota || quota.quotaType === "none") {
    return (
      <Card padding="sm">
        <div className="flex items-center gap-2 text-text-muted text-sm">
          <span className="material-symbols-outlined text-[16px]">speed</span>
          No quota limit
        </div>
      </Card>
    );
  }

  const pct = Math.min(100, (quota.used / quota.limit) * 100);
  const barColor =
    pct > 95 ? "bg-red-500" : pct > 80 ? "bg-amber-400" : "bg-primary";
  const isCredit = quota.quotaType === "credit";
  const title = isCredit ? "Credit" : "Quota";

  return (
    <Card padding="sm" className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-text-muted text-sm">
        <span className="material-symbols-outlined text-[16px]">speed</span>
        <span className="font-medium text-text-main">{title}</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-border/40 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${Math.max(pct, 1)}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-text-muted">
        <span>{fmtCost(quota.used)} / {fmtCost(quota.limit)} used</span>
        <span>{fmtCost(quota.remaining)} remaining</span>
      </div>
      <div className="text-xs text-text-muted">
        {isCredit
          ? "Fixed credit — no reset"
          : quota.resetsAt
          ? `Resets at ${new Date(quota.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
          : `Resets every ${quota.resetHours}h`}
      </div>
    </Card>
  );
}

const PIE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#14b8a6"];

function CostPieChart({ byModel }) {
  if (!byModel || byModel.length === 0) return null;
  const data = byModel.filter((m) => m.cost > 0).map((m) => ({ name: m.model, value: m.cost }));
  if (data.length === 0) return null;

  return (
    <Card padding="sm">
      <h2 className="mb-3 text-sm font-semibold text-text-main">Cost by Model</h2>
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`} labelLine={false}>
              {data.map((_, i) => (
                <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => `$${v.toFixed(4)}`} contentStyle={{ background: "var(--color-bg-surface)", border: "1px solid var(--color-border)", borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function RecentRequests({ data, loading }) {
  if (loading) {
    return (
      <Card padding="sm">
        <h2 className="mb-3 text-sm font-semibold text-text-main">Recent Requests</h2>
        <div className="text-sm text-text-muted animate-pulse">Loading...</div>
      </Card>
    );
  }
  if (!data || data.length === 0) return null;

  return (
    <Card padding="sm">
      <h2 className="mb-3 text-sm font-semibold text-text-main">Recent Requests</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-left text-text-muted">
              <th className="pb-2 pr-4 font-medium">Time</th>
              <th className="pb-2 pr-4 font-medium">Model</th>
              <th className="pb-2 pr-4 font-medium text-right">Tokens</th>
              <th className="pb-2 font-medium text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r, i) => (
              <tr key={i} className="border-b border-border-subtle last:border-b-0 hover:bg-surface-2/50 transition-colors">
                <td className="py-1.5 pr-4 text-text-muted text-xs whitespace-nowrap">
                  {new Date(r.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="py-1.5 pr-4 text-text-main font-mono text-xs">{r.model || "unknown"}</td>
                <td className="py-1.5 pr-4 text-right text-text-main text-xs">{fmtTokens((r.promptTokens || 0) + (r.completionTokens || 0))}</td>
                <td className="py-1.5 text-right text-text-main text-xs">{fmtCost(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function UsagePage() {
  const [apiKey, setApiKey] = useState("");
  const [inputKey, setInputKey] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [period, setPeriod] = useState("24h");
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [models, setModels] = useState([]);
  const [copiedModel, setCopiedModel] = useState(null);
  const [quota, setQuota] = useState(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState("");

  // Load saved key on mount
  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? localStorage.getItem(LS_KEY) : null;
    if (saved) {
      setApiKey(saved);
      setInputKey(saved);
      setRememberMe(true);
    }
  }, []);

  const fetchStats = useCallback(async (key, per) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/public/usage?period=${per}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.status === 401) {
        setError("Invalid API key");
        setStats(null);
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch stats");
      const json = await res.json();
      setStats(json);
    } catch (e) {
      setError(e.message || "Failed to fetch stats");
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchChart = useCallback(async (key, per) => {
    setChartLoading(true);
    try {
      const res = await fetch(`/api/public/usage/chart?period=${per}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const json = await res.json();
        setChartData(json.data || []);
      }
    } catch {
      setChartData([]);
    } finally {
      setChartLoading(false);
    }
  }, []);

  const fetchQuota = useCallback(async (key) => {
    setQuotaLoading(true);
    try {
      const res = await fetch("/api/public/usage/quota", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const json = await res.json();
        setQuota(json);
      }
    } catch {
      setQuota(null);
    } finally {
      setQuotaLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async (key) => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/public/usage/history?limit=20", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const json = await res.json();
        setHistory(json.data || []);
      }
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const fetchModels = useCallback(async (key) => {
    try {
      const res = await fetch("/api/public/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const json = await res.json();
        setModels(json.models || []);
      }
    } catch {
      setModels([]);
    }
  }, []);

  useEffect(() => {
    if (!apiKey) return;
    fetchStats(apiKey, period);
    fetchChart(apiKey, period);
    fetchQuota(apiKey);
    fetchHistory(apiKey);
  }, [apiKey, period, fetchStats, fetchChart, fetchQuota, fetchHistory]);

  useEffect(() => {
    if (!apiKey) return;
    fetchModels(apiKey);
  }, [apiKey, fetchModels]);

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = inputKey.trim();
    if (!trimmed) return;
    if (rememberMe) {
      localStorage.setItem(LS_KEY, trimmed);
    } else {
      localStorage.removeItem(LS_KEY);
    }
    setApiKey(trimmed);
  }

  function handleLogout() {
    setApiKey("");
    setInputKey("");
    setStats(null);
    setChartData([]);
    setModels([]);
    setQuota(null);
    setHistory([]);
    setError("");
    localStorage.removeItem(LS_KEY);
  }

  const isAuthed = Boolean(apiKey);

  return (
    <div className="min-h-screen bg-bg text-text-main">
      <div className="mx-auto max-w-4xl px-4 py-10">
        {/* Header */}
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-text-main">
              Usage Tracking
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              Monitor your API usage, token consumption, and costs.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://t.me/quangnx99"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-muted transition-colors hover:border-border hover:text-text"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
              </svg>
              Liên hệ Admin
            </a>
            {isAuthed && (
              <button
                onClick={handleLogout}
                className="flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-muted transition-colors hover:border-border hover:text-text"
              >
                <span className="material-symbols-outlined text-[16px]">
                  logout
                </span>
                Sign out
              </button>
            )}
          </div>
        </div>

        {/* API Key Form */}
        {!isAuthed && (
          <Card padding="md" className="mx-auto max-w-md">
            <h2 className="mb-4 text-base font-semibold text-text-main">
              Enter your API key
            </h2>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="apikey" className="text-sm text-text-muted">
                  API Key
                </label>
                <input
                  id="apikey"
                  type="password"
                  value={inputKey}
                  onChange={(e) => setInputKey(e.target.value)}
                  placeholder="sk-..."
                  autoComplete="current-password"
                  className="rounded-lg border border-border-subtle bg-bg px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-text-muted">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-border-subtle accent-primary"
                />
                Remember me
              </label>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={!inputKey.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50 hover:opacity-90"
              >
                View Usage
              </button>
            </form>
          </Card>
        )}

        {/* Authenticated view */}
        {isAuthed && (
          <div className="flex flex-col gap-6">
            {/* Period selector */}
            <div className="flex gap-1 self-start rounded-lg border border-border bg-bg-subtle p-1">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                    period === p
                      ? "bg-primary text-white shadow-sm"
                      : "text-text-muted hover:text-text hover:bg-bg-hover",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Connection Info */}
            <ConnectionInfo apiKey={apiKey} />

            {/* Quota */}
            <QuotaCard quota={quota} loading={quotaLoading} />

            {/* Error banner */}
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            {/* Summary cards */}
            {loading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <Card
                    key={i}
                    padding="sm"
                    className="h-20 animate-pulse bg-surface"
                  />
                ))}
              </div>
            ) : stats ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCard
                  label="Total Requests"
                  value={fmtNumber(stats.totalRequests)}
                  icon="swap_horiz"
                />
                <StatCard
                  label="Total Tokens"
                  value={fmtTokens(stats.totalTokens)}
                  icon="token"
                />
                <StatCard
                  label="Total Cost"
                  value={fmtCost(stats.totalCost)}
                  icon="payments"
                />
              </div>
            ) : null}

            {/* Chart */}
            <UsageChartInline data={chartData} loading={chartLoading} />

            {/* Model breakdown */}
            {stats && stats.byModel && stats.byModel.length > 0 && (
              <Card padding="sm">
                <h2 className="mb-3 text-sm font-semibold text-text-main">
                  By Model
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border-subtle text-left text-text-muted">
                        <th className="pb-2 pr-4 font-medium">Model</th>
                        <th className="pb-2 pr-4 font-medium">Provider</th>
                        <th className="pb-2 pr-4 font-medium text-right">
                          Requests
                        </th>
                        <th className="pb-2 pr-4 font-medium text-right">
                          Tokens
                        </th>
                        <th className="pb-2 font-medium text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.byModel.map((m, i) => (
                        <tr
                          key={i}
                          className="border-b border-border-subtle last:border-b-0 hover:bg-surface-2/50 transition-colors"
                        >
                          <td className="py-2 pr-4 text-text-main font-mono text-xs">
                            {m.model}
                          </td>
                          <td className="py-2 pr-4 text-text-muted">
                            {m.provider}
                          </td>
                          <td className="py-2 pr-4 text-right text-text-main">
                            {fmtNumber(m.requests)}
                          </td>
                          <td className="py-2 pr-4 text-right text-text-main">
                            {fmtTokens(m.tokens)}
                          </td>
                          <td className="py-2 text-right text-text-main">
                            {fmtCost(m.cost)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* Cost pie chart */}
            {stats && <CostPieChart byModel={stats.byModel} />}

            {/* Recent requests */}
            <RecentRequests data={history} loading={historyLoading} />

            {/* Available models */}
            {models.length > 0 && (
              <Card padding="sm">
                <h2 className="mb-3 text-sm font-semibold text-text-main">
                  Available Models
                </h2>
                <div className="flex flex-wrap gap-2">
                  {models.map((m, i) => (
                    <div
                      key={i}
                      className="group flex items-center gap-2 rounded-lg border border-border-subtle bg-bg px-3 py-1.5"
                    >
                      <span className="text-sm text-text-main font-mono">
                        {m.name}
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(m.name).then(() => {
                            setCopiedModel(m.name);
                            setTimeout(() => setCopiedModel(null), 2000);
                          });
                        }}
                        className={cn(
                          "transition-colors",
                          copiedModel === m.name ? "text-green-500" : "text-text-muted hover:text-text-main"
                        )}
                        title="Copy model name"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {copiedModel === m.name ? "check_circle" : "content_copy"}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Empty state */}
            {!loading && stats && stats.totalRequests === 0 && (
              <div className="rounded-lg border border-border-subtle bg-surface px-6 py-10 text-center text-text-muted">
                <span className="material-symbols-outlined mb-2 block text-[32px]">
                  bar_chart
                </span>
                No usage data for this period.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
