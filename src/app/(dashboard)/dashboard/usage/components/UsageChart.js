"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
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

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;
const fmtRequests = (n) => String(n || 0);

const VIEW_MODES = [
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
  { value: "cost", label: "Cost" },
];

const VIEW_CONFIG = {
  tokens:   { dataKey: "tokens",   color: "#6366f1", gradId: "gradTokens",   formatter: fmtTokens,   label: "Tokens" },
  requests: { dataKey: "requests", color: "#14b8a6", gradId: "gradRequests", formatter: fmtRequests, label: "Requests" },
  cost:     { dataKey: "cost",     color: "#f59e0b", gradId: "gradCost",     formatter: fmtCost,     label: "Cost" },
};

// Periods bucketed by day. Their series is a flat baseline with a single
// spike (one busy day among empty ones), which reads as a straight line rather
// than a chart - the operator asked for it to be gone. The hour-bucketed
// periods keep their card, so this returns nothing for the coarse ones.
const DAILY_PERIODS = new Set(["7d", "30d", "60d", "all"]);

export default function UsageChart({ period = "7d", updateKey = 0 }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("tokens");

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/usage/chart?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to fetch chart data:", e);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (updateKey > 0) {
      fetchData(true);
    }
  }, [updateKey, fetchData]);

  // Hidden before the first render too: rendering a card and then dropping it
  // would flash a "Loading..." box that never explains itself.
  if (DAILY_PERIODS.has(period)) return null;

  const cfg = VIEW_CONFIG[viewMode];
  const hasData = data.some((d) => (d[cfg.dataKey] || 0) > 0);

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div
        className="grid w-full items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:w-auto sm:self-start"
        style={{ gridTemplateColumns: `repeat(${VIEW_MODES.length}, minmax(0, 1fr))` }}
      >
        {VIEW_MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => setViewMode(m.value)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === m.value ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="h-44 flex items-center justify-center text-text-muted text-sm gap-2">
          <span className="material-symbols-outlined text-[18px] animate-spin text-primary">autorenew</span>
          <span>Loading telemetry series...</span>
        </div>
      ) : !hasData ? (
        <div className="h-44 flex flex-col items-center justify-center text-center px-4 gap-2 border border-dashed border-border-subtle rounded-[var(--r-control)] bg-surface-2/30 my-1">
          <span className="material-symbols-outlined text-[26px] text-text-subtle select-none">query_stats</span>
          <div className="text-xs font-medium text-text-main">No activity recorded for this timeframe</div>
          <span className="text-[11px] text-text-muted max-w-sm">
            Requests sent to your models will plot throughput, token speeds, and cost metrics dynamically here.
          </span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradRequests" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1">
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
              tickFormatter={cfg.formatter}
              width={50}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              formatter={(value) => [cfg.formatter(value), cfg.label]}
            />
            <Area
              type="monotone"
              dataKey={cfg.dataKey}
              stroke={cfg.color}
              strokeWidth={2}
              fill={`url(#${cfg.gradId})`}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
};
