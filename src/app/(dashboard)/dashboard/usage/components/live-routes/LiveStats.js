"use client";

import Card from "@/shared/components/Card";
import { formatLatency, formatRate } from "@/shared/utils/liveRoutes";

export default function LiveStats({ summary }) {
  const items = [
    ["Requests in window", summary.requestsInWindow, "text-text-main"],
    ["In progress", summary.inProgress, "text-warning"],
    ["Success rate", summary.successRate == null ? "—" : `${summary.successRate.toFixed(1)}%`, "text-success"],
    ["Output tok/s", formatRate(summary.outputTokPerSec), "text-primary"],
    ["Avg latency", formatLatency(summary.avgLatency), "text-info"],
  ];
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{items.map(([label, value, color]) => (
    <Card key={label} padding="sm" className="min-w-0 border-border-subtle/80 bg-surface-2/40">
      <div className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">{label}</div>
      <div className={`mt-1 font-mono text-xl font-bold tabular-nums ${color}`}>{value}</div>
    </Card>
  ))}</div>;
}
