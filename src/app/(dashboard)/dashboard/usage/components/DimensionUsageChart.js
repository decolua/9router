"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Card from "@/shared/components/Card";

const COLORS = ["#ef6a47", "#2563eb", "#16a34a", "#9333ea", "#0891b2", "#ca8a04", "#db2777", "#4f46e5"];
const formatValue = (value, metric) => metric === "latency" ? `${Number(value || 0).toFixed(0)}ms` : new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(value || 0);

export default function DimensionUsageChart({ title, dimension, metric = "tokens", period, startDate, endDate, mergeModels = true }) {
  const [result, setResult] = useState({ series: [], data: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const query = new URLSearchParams({ dimension, metric, period });
    if (dimension === "model") query.set("mergeModels", String(mergeModels));
    if (period === "custom") {
      if (startDate) query.set("startDate", startDate);
      if (endDate) query.set("endDate", endDate);
    }
    let cancelled = false;
    fetch(`/api/usage/dimension-chart?${query.toString()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("加载曲线失败")))
      .then((data) => { if (!cancelled) setResult(data); })
      .catch(() => { if (!cancelled) setResult({ series: [], data: [] }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dimension, metric, period, startDate, endDate, mergeModels]);

  const hasData = result.series.length > 0 && result.data.some((point) => result.series.some((series) => Number(point[series.id] || 0) > 0));
  return (
    <Card className="min-w-0 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-xs text-text-muted">最多显示前 8 项</span>
      </div>
      {loading ? <div className="flex h-72 items-center justify-center text-sm text-text-muted">正在加载...</div>
        : !hasData ? <div className="flex h-72 items-center justify-center text-sm text-text-muted">当前时间范围暂无数据</div>
          : <div className="flex min-w-0 flex-col gap-3 lg:flex-row">
              <div className="h-[320px] min-w-0 flex-1"><ResponsiveContainer width="100%" height="100%">
                <LineChart data={result.data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={58} tickFormatter={(value) => formatValue(value, metric)} />
                  <Tooltip formatter={(value) => formatValue(value, metric)} contentStyle={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12 }} />
                  {result.series.map((series, index) => <Line key={series.id} type="monotone" dataKey={series.id} name={series.label} stroke={COLORS[index % COLORS.length]} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />)}
                </LineChart>
              </ResponsiveContainer></div>
              <div className="grid max-h-[320px] grid-cols-2 content-start gap-2 overflow-y-auto border-t border-border pt-3 text-xs lg:w-48 lg:grid-cols-1 lg:border-l lg:border-t-0 lg:pl-3 lg:pt-1">
                {result.series.map((series, index) => <div key={series.id} className="flex min-w-0 items-center gap-2" title={series.label}><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} /><span className="truncate">{series.label}</span></div>)}
              </div>
            </div>}
    </Card>
  );
}

DimensionUsageChart.propTypes = {
  title: PropTypes.string.isRequired,
  dimension: PropTypes.oneOf(["apiKey", "provider", "model"]).isRequired,
  metric: PropTypes.oneOf(["tokens", "requests", "latency"]),
  period: PropTypes.string.isRequired,
  startDate: PropTypes.string,
  endDate: PropTypes.string,
  mergeModels: PropTypes.bool,
};
