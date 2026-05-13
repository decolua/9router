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

export default function UsagePage() {
  const [apiKey, setApiKey] = useState("");
  const [inputKey, setInputKey] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [period, setPeriod] = useState("24h");
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
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
  }, [apiKey, period, fetchStats, fetchChart]);

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
                          navigator.clipboard.writeText(m.name);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-text-main"
                        title="Copy model name"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          content_copy
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
