"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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

export default function UsageChart({ period = "7d" }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("tokens");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/chart?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to fetch chart data:", e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchData();
    }, 0);

    return () => clearTimeout(timer);
  }, [fetchData]);

  const hasData = data.some((d) => d.tokens > 0 || d.cost > 0);
  const chartSummary = useMemo(() => {
    const totals = data.reduce(
      (acc, item) => ({
        tokens: acc.tokens + (item.tokens || 0),
        cost: acc.cost + (item.cost || 0),
      }),
      { tokens: 0, cost: 0 },
    );
    const peak = data.reduce((max, item) => {
      const currentValue =
        viewMode === "tokens" ? item.tokens || 0 : item.cost || 0;
      const maxValue = viewMode === "tokens" ? max.tokens || 0 : max.cost || 0;
      return currentValue > maxValue ? item : max;
    }, data[0] || {});
    const metric = viewMode === "tokens" ? "tokens" : "cost";
    const totalValue =
      viewMode === "tokens" ? fmtTokens(totals.tokens) : fmtCost(totals.cost);
    const peakValue =
      viewMode === "tokens" ? fmtTokens(peak.tokens) : fmtCost(peak.cost);
    return `Usage chart for ${period}: total ${metric} ${totalValue}. Peak ${metric} ${peakValue} on ${peak.label || "the selected period"}.`;
  }, [data, period, viewMode]);

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div className="grid w-full grid-cols-2 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:w-auto sm:self-start">
        <button
          onClick={() => setViewMode("tokens")}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === "tokens" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
        >
          Tokens
        </button>
        <button
          onClick={() => setViewMode("cost")}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === "cost" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
        >
          Cost
        </button>
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
        <div
          role="img"
          aria-label="Usage trend chart"
          aria-describedby="usage-chart-summary"
        >
          <p id="usage-chart-summary" className="sr-only">
            {chartSummary}
          </p>
          <table className="sr-only">
            <caption>Usage chart data</caption>
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Tokens</th>
                <th scope="col">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <tr key={item.label}>
                  <td>{item.label}</td>
                  <td>{fmtTokens(item.tokens)}</td>
                  <td>{fmtCost(item.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart
              data={data}
              margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
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
                  fill="url(#gradTokens)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ) : (
                <Area
                  type="monotone"
                  dataKey="cost"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  fill="url(#gradCost)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
};
