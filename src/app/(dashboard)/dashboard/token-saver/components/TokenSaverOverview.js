"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/shared/components";

const PERIODS = [
  ["today", "Today"],
  ["7d", "7D"],
  ["30d", "30D"],
  ["60d", "60D"],
  ["365d", "365D"],
];

const bytes = (value) => {
  const n = Number(value) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
};

const number = (value) => new Intl.NumberFormat().format(Number(value) || 0);

function StatCard({ label, value, detail, tone = "text-text" }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${tone}`}>{value}</p>
      <p className="mt-1 text-xs text-text-muted">{detail}</p>
    </Card>
  );
}

export default function TokenSaverOverview() {
  const [period, setPeriod] = useState("30d");
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stream = new EventSource(`/api/token-saver/stream?period=${period}`);
    stream.onerror = () => setLoading(false);
    stream.onmessage = (event) => {
      try {
        setStats(JSON.parse(event.data));
        setLoading(false);
      } catch {}
    };
    return () => stream.close();
  }, [period]);

  const rtk = stats?.rtk || {};
  const headroom = stats?.headroom || {};
  const points = (stats?.dailyPoints || []).map((point) => ({
    ...point,
    label: new Date(`${point.dateKey}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
  }));
  const skipReasons = Object.entries(headroom.skipReasons || {}).sort((a, b) => b[1] - a[1]);
  const isEmpty = !stats?.requestsObserved;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Overview</h2>
          <p className="text-sm text-text-muted">Aggregate pre-provider compression metrics. No provider billing estimate.</p>
        </div>
        <div className="flex rounded-lg border border-border bg-surface-2 p-1">
          {PERIODS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setPeriod(id)}
              className={`rounded-md px-3 py-1 text-xs font-medium ${period === id ? "bg-primary text-white" : "text-text-muted hover:text-text"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Card className="p-8 text-center text-sm text-text-muted">Loading Token Saver metrics…</Card>
      ) : isEmpty ? (
        <Card className="p-8 text-center text-sm text-text-muted">No Token Saver events yet. Send a request through 9router after enabling RTK or Headroom.</Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="RTK bytes saved" value={bytes(rtk.bytesSaved)} detail={`${number(rtk.requestsWithHits)} requests with ${number(rtk.hits)} hits`} tone="text-success" />
            <StatCard label="Headroom token delta" value={number(headroom.tokensSaved)} detail={`${number(headroom.compressed)} compressed requests; reported by Headroom`} tone="text-primary" />
            <StatCard label="Actual payload shrink" value={bytes(stats?.totals?.actualBytesSaved)} detail={`${bytes(headroom.bodyBytesBefore)} → ${bytes(headroom.bodyBytesAfter)} Headroom body`} />
            <StatCard label="Headroom skipped" value={number(headroom.skipped)} detail={`${number(headroom.phantomSavings)} sub-5% body shrink (phantom)`} tone={headroom.skipped || headroom.phantomSavings ? "text-warning" : "text-text"} />
          </div>

          <Card className="p-4">
            <div className="mb-3">
              <h3 className="font-medium">Actual bytes saved</h3>
              <p className="text-xs text-text-muted">RTK output reduction plus non-negative Headroom body reduction.</p>
            </div>
            {points.some((point) => point.actualBytesSaved > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tokenSaverBytes" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} tickFormatter={bytes} width={56} />
                  <Tooltip contentStyle={{ backgroundColor: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: "8px", fontSize: "12px" }} formatter={(value) => [bytes(value), "Bytes saved"]} />
                  <Area type="monotone" dataKey="actualBytesSaved" stroke="#6366f1" strokeWidth={2} fill="url(#tokenSaverBytes)" dot={false} activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-10 text-center text-sm text-text-muted">No actual payload reduction in this period.</p>
            )}
          </Card>

          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <h3 className="font-medium">Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-xs text-text-muted">
                  <tr><th className="px-4 py-2 font-medium">Saver</th><th className="px-4 py-2 font-medium">Requests</th><th className="px-4 py-2 font-medium">Reported tokens</th><th className="px-4 py-2 font-medium">Actual bytes saved</th><th className="px-4 py-2 font-medium">Status</th></tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border"><td className="px-4 py-3 font-medium">RTK</td><td className="px-4 py-3">{number(rtk.requestsWithHits)} hit requests</td><td className="px-4 py-3">—</td><td className="px-4 py-3">{bytes(rtk.bytesSaved)}</td><td className="px-4 py-3 text-text-muted">{number(rtk.hits)} tool-output hits</td></tr>
                  <tr><td className="px-4 py-3 font-medium">Headroom</td><td className="px-4 py-3">{number(headroom.compressed)} compressed / {number(headroom.skipped)} skipped</td><td className="px-4 py-3">{number(headroom.tokensSaved)}</td><td className="px-4 py-3">{bytes(Math.max(0, (headroom.bodyBytesBefore || 0) - (headroom.bodyBytesAfter || 0)))}</td><td className="px-4 py-3 text-text-muted">{skipReasons[0] ? `${skipReasons[0][0]}: ${number(skipReasons[0][1])}` : `${number(headroom.disabled)} disabled`}</td></tr>
                </tbody>
              </table>
            </div>
          </Card>
          {(headroom.phantomSavings > 0 || headroom.skipped > 0) && <p className="text-xs text-text-muted">Skips are aggregate-safe (counted, not saved). A sub-5% body shrink is phantom savings — Headroom reported a reduction but the provider may bill near the original payload.</p>}
        </>
      )}
    </section>
  );
}
