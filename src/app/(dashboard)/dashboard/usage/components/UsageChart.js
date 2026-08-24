"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import Card from "@/shared/components/Card";

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

const fmtCost = (n) => `$${(n || 0).toFixed(4)}`;

export default function UsageChart({ period = "7d", startDate = "", endDate = "" }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("tokens");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ period });
      if (period === "custom") {
        if (startDate) query.set("startDate", startDate);
        if (endDate) query.set("endDate", endDate);
      }
      const res = await fetch(`/api/usage/chart?${query.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (e) {
      console.error("Failed to fetch chart data:", e);
    } finally {
      setLoading(false);
    }
  }, [period, startDate, endDate]);

  useEffect(() => {
    const timer = setTimeout(fetchData, 0);
    return () => clearTimeout(timer);
  }, [fetchData]);

  const hasData = data.some((d) => d.tokens > 0 || d.cost > 0);

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
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">Loading...</div>
      ) : !hasData ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">No data for this period</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          {viewMode === "tokens" ? (
            <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis yAxisId="tokens" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} tickFormatter={fmtTokens} width={52} />
              <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} width={40} />
              <Tooltip contentStyle={{ backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "6px", fontSize: "12px" }} formatter={(value, name) => name === "缓存命中率" ? [`${Number(value).toFixed(2)}%`, name] : [fmtTokens(value), name]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="tokens" type="monotone" dataKey="inputTokens" name="输入" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
              <Line yAxisId="tokens" type="monotone" dataKey="outputTokens" name="输出" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
              <Line yAxisId="tokens" type="monotone" dataKey="cacheCreationTokens" name="缓存写入" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
              <Line yAxisId="tokens" type="monotone" dataKey="cacheReadTokens" name="缓存读取" stroke="#06b6d4" strokeWidth={2.5} dot={false} activeDot={{ r: 3 }} />
              <Line yAxisId="rate" type="monotone" dataKey="cacheHitRate" name="缓存命中率" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="4 3" dot={false} activeDot={{ r: 3 }} />
            </LineChart>
          ) : (
            <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs><linearGradient id="gradCost" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} tickFormatter={fmtCost} width={58} />
              <Tooltip contentStyle={{ backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "6px", fontSize: "12px" }} formatter={(value) => [fmtCost(value), "费用"]} />
              <Area type="monotone" dataKey="cost" name="费用" stroke="#f59e0b" strokeWidth={2} fill="url(#gradCost)" dot={false} activeDot={{ r: 4 }} />
            </AreaChart>
          )}
        </ResponsiveContainer>
      )}
    </Card>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
  startDate: PropTypes.string,
  endDate: PropTypes.string,
};
