"use client";

import { useState, useEffect, useCallback, useMemo, startTransition } from "react";
import PropTypes from "prop-types";
import { buildLatencyData } from "./latencyUtils.js";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
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

const fmtLatencyLabel = (v) => {
  const ms = Math.round(Math.pow(10, v));
  return ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`;
};

const RangeShape = (props) => {
  const { x, y, width, height, payload } = props;
  const { p50Frac } = payload;
  if (width <= 0 || height <= 0 || p50Frac <= 0) return null;
  const x0 = x + width * p50Frac;
  const visWidth = Math.max(0, x + width - x0);
  if (visWidth <= 0) return null;
  return (
    <>
      <rect
        x={x0}
        y={y}
        width={visWidth}
        height={height}
        rx={4}
        ry={4}
        fill="#93c5fd"
      />
      <circle
        cx={x + width}
        cy={y + height / 2}
        r={3.5}
        fill="#1e40af"
      />
    </>
  );
};

RangeShape.propTypes = {
  x: PropTypes.number.isRequired,
  y: PropTypes.number.isRequired,
  width: PropTypes.number.isRequired,
  height: PropTypes.number.isRequired,
  payload: PropTypes.object,
};

const CustomTooltip = ({ active, payload, label, metric = "total" }) => {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0].payload;
  const p50 = metric === "ttft" ? entry.p50Ttft : entry.p50Total;
  const p95 = metric === "ttft" ? entry.p95Ttft : entry.p95Total;
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2 shadow-lg text-xs">
      <p className="font-medium mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-text-muted">P50</span>
        <span className="font-mono">{p50}ms</span>
        <span className="text-text-muted">→</span>
        <span className="font-mono">{p95}ms</span>
        <span className="text-text-muted">({entry.count})</span>
      </div>
      <div className="mt-1 pt-1 border-t border-border/50">
        <div className="flex items-baseline gap-2">
          <span className="text-text-muted">TTFT P50</span>
          <span className="font-mono">{entry.p50Ttft}ms</span>
          <span className="text-text-muted">P95</span>
          <span className="font-mono">{entry.p95Ttft}ms</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-text-muted">Total P50</span>
          <span className="font-mono">{entry.p50Total}ms</span>
          <span className="text-text-muted">P95</span>
          <span className="font-mono">{entry.p95Total}ms</span>
        </div>
      </div>
    </div>
  );
};

CustomTooltip.propTypes = {
  active: PropTypes.bool,
  payload: PropTypes.array,
  label: PropTypes.string,
  metric: PropTypes.string,
};

export default function UsageChart({ period = "7d", tableView = "model", stats }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("tokens");
  const [latencyMetric, setLatencyMetric] = useState("total");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/chart?period=${period}`);
      if (res.ok) {
        const json = await res.json();
        startTransition(() => setData(json));
      }
    } catch (e) {
      console.error("Failed to fetch chart data:", e);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const id = setTimeout(() => fetchData(), 0);
    return () => clearTimeout(id);
  }, [fetchData]);

  const latency = useMemo(
    () => buildLatencyData(stats?.latencyByModel, latencyMetric),
    [stats, latencyMetric],
  );

  const hasData = data.some((d) => d.tokens > 0 || d.cost > 0);
  const chartHeight = latency.data.length > 0
    ? Math.max(140, latency.data.length * 22 + 50)
    : 140;

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div className="grid w-full grid-cols-3 items-center gap-1 rounded-lg border border-border bg-bg-subtle p-1 sm:w-auto sm:self-start">
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
        <button
          onClick={() => setViewMode("latency")}
          className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${viewMode === "latency" ? "bg-primary text-white shadow-sm" : "text-text-muted hover:text-text hover:bg-bg-hover"}`}
        >
          Latency
        </button>
      </div>

      {loading ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">Loading...</div>
      ) : viewMode === "latency" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-text-muted">
                Latency distribution
              </span>
              <div className="flex rounded-md border border-border overflow-hidden">
                <button
                  onClick={() => setLatencyMetric("total")}
                  className={`px-2 py-1 text-xs font-medium transition-colors ${
                    latencyMetric === "total"
                      ? "bg-primary text-white"
                      : "text-text-muted hover:text-text hover:bg-bg-hover"
                  }`}
                >
                  Total
                </button>
                <button
                  onClick={() => setLatencyMetric("ttft")}
                  className={`px-2 py-1 text-xs font-medium transition-colors ${
                    latencyMetric === "ttft"
                      ? "bg-primary text-white"
                      : "text-text-muted hover:text-text hover:bg-bg-hover"
                  }`}
                >
                  TTFT
                </button>
              </div>
            </div>
            {latency.data.length > 0 ? (
              <div className="flex items-center gap-4 text-xs text-text-muted">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-3 h-3 rounded-sm bg-[#93c5fd]"></span>
                  P50–P95
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-[#1e40af]"></span>
                  P95
                </span>
                <span className="ml-auto text-text-muted">
                  Sorted by {latencyMetric === "ttft" ? "TTFT" : "Total"} P95
                </span>
              </div>
            ) : (
              <div className="h-10 flex items-center text-text-muted text-xs">
                No latency data for this period
              </div>
            )}
            <div
              role="img"
              aria-label={`Latency range chart showing P50 to P95 per model, sorted by worst tail latency first. ${latency.data.length} models above threshold.`}
            >
              <ResponsiveContainer key={period} width="100%" height={chartHeight}>
                <BarChart
                  data={latency.data}
                  layout="vertical"
                  margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                  barSize={18}
                >
                  <defs>
                    <linearGradient id="latencyGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#bfdbfe" />
                      <stop offset="80%" stopColor="#60a5fa" />
                      <stop offset="100%" stopColor="#1e40af" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    strokeOpacity={0.1}
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    domain={latency.domain}
                    ticks={latency.ticks}
                    tickFormatter={fmtLatencyLabel}
                    tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.6 }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                  />
                  <YAxis
                    type="category"
                    dataKey="key"
                    tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.8 }}
                    axisLine={false}
                    tickLine={false}
                    width={150}
                  />
                  <Tooltip
                    content={<CustomTooltip metric={latencyMetric} />}
                    cursor={{ fill: "transparent" }}
                  />
                  <Bar
                    dataKey="p95Log"
                    fill="url(#latencyGrad)"
                    shape={<RangeShape />}
                    isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          {latency.excluded > 0 && (
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-1 text-left text-text-muted font-medium">
                      Model
                    </th>
                    <th className="px-3 py-1 text-right text-text-muted font-medium">
                      Requests
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {latency.noisy.map((e) => (
                    <tr
                      key={e.key}
                      className="border-b border-border/50 last:border-0 hover:bg-bg-hover/50"
                    >
                      <td className="px-3 py-1 truncate max-w-[200px]" title={e.key}>
                        {e.key}
                      </td>
                      <td className="px-3 py-1 text-right text-text-muted">
                        {e.count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-1 text-text-muted text-xs bg-bg-subtle">
                {latency.excluded} low-volume models excluded (below 10 requests)
              </div>
            </div>
          )}
        </div>
      ) : !hasData ? (
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">
          No data for this period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
              formatter={(value, name) => {
                if (name === "tokens") return [fmtTokens(value), "Tokens"];
                if (name === "cost") return [fmtCost(value), "Cost"];
                return [value, name];
              }}
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
      )}
    </Card>
  );
}

UsageChart.propTypes = {
  period: PropTypes.string,
  tableView: PropTypes.string,
  stats: PropTypes.object,
};
