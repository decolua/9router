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
  Legend,
} from "recharts";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);

export default function DlpStats({ period = "7d" }) {
  const [stats, setStats] = useState(null);
  const [chart, setChart] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/dlp?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        setStats(json.stats);
        setChart(json.chart || []);
      }
    } catch (e) {
      console.error("Failed to fetch DLP stats:", e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalMatched = stats?.totalMatched || 0;
  const hasData = totalMatched > 0 || chart.some((d) => d.masked > 0);

  // Top categories by masked value count (readable keys: built-in ids / custom names).
  const byType = stats?.byType || {};
  const topCategories = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxCat = topCategories[0]?.[1] || 1;
  const modeLabel = stats?.mode === "pseudo" ? "Pseudo" : "Redact";

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      {/* Section header */}
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <span className="text-text-main text-sm font-semibold uppercase tracking-wide">Privacy & DLP</span>
        <span className="rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-[11px] font-medium text-text-muted">
          Mode: {modeLabel}
        </span>
      </div>

      {/* Overview cards */}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 sm:gap-4">
        <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
          <span className="text-text-muted text-sm uppercase font-semibold">Values Masked</span>
          <span className="truncate text-2xl font-bold text-primary">{fmt(totalMatched)}</span>
        </Card>
        <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
          <span className="text-text-muted text-sm uppercase font-semibold">Requests With PII</span>
          <span className="truncate text-2xl font-bold text-info">{fmt(stats?.maskedRequests || 0)}</span>
        </Card>
        <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
          <span className="text-text-muted text-sm uppercase font-semibold">Responses Masked</span>
          <span className="truncate text-2xl font-bold text-success">{fmt(stats?.maskedResponses || 0)}</span>
        </Card>
        <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
          <span className="text-text-muted text-sm uppercase font-semibold">Top Category</span>
          <span className="truncate text-2xl font-bold text-warning">
            {stats?.topCategory?.name || "—"}
          </span>
          {stats?.topCategory && (
            <span className="text-[10px] text-text-muted">{fmt(stats.topCategory.count)} values</span>
          )}
        </Card>
      </div>

      {/* Chart */}
      {loading ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">Loading...</div>
      ) : !hasData ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">No DLP masking data for this period</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradDlpReq" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradDlpResp" x1="0" y1="0" x2="0" y2="1">
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
              width={50}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              formatter={(value, name) => {
                if (name === "requests") return [fmt(value), "Masked requests"];
                if (name === "responses") return [fmt(value), "Masked responses"];
                return [fmt(value), name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area
              type="monotone"
              dataKey="requests"
              stroke="#6366f1"
              strokeWidth={2}
              fill="url(#gradDlpReq)"
              dot={false}
              activeDot={{ r: 4 }}
            />
            <Area
              type="monotone"
              dataKey="responses"
              stroke="#f59e0b"
              strokeWidth={2}
              fill="url(#gradDlpResp)"
              dot={false}
              activeDot={{ r: 4 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}

      {/* Top categories breakdown */}
      {topCategories.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {topCategories.map(([name, count]) => (
            <div key={name} className="flex items-center gap-2 text-xs">
              <span className="w-32 truncate text-text-muted">{name}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-subtle">
                <div
                  className="h-full rounded-full bg-primary/60"
                  style={{ width: `${Math.max(4, (count / maxCat) * 100)}%` }}
                />
              </div>
              <span className="w-12 text-right font-medium tabular-nums">{fmt(count)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

DlpStats.propTypes = {
  period: PropTypes.string,
};