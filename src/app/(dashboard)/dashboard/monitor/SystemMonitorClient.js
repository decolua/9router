"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card } from "@/shared/components";

const fmt = (value) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value || 0);
const percentile = (values, rate) => values.length ? values[Math.min(values.length - 1, Math.floor(values.length * rate))] : 0;

function Stat({ label, value, detail, color = "text-text-main" }) {
  return <Card className="p-4"><p className="text-xs text-text-muted">{label}</p><p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</p><p className="mt-1 text-xs text-text-muted">{detail}</p></Card>;
}

export default function SystemMonitorClient() {
  const [snapshot, setSnapshot] = useState({ logs: [], connections: [], stats: {} });
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 60 * 60 * 1000);
      const [logResponse, providerResponse, statsResponse] = await Promise.all([
        fetch(`/api/usage/request-logs?page=1&pageSize=200&startDate=${encodeURIComponent(start.toISOString())}&endDate=${encodeURIComponent(end.toISOString())}`, { cache: "no-store" }),
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/usage/stats?period=today", { cache: "no-store" }),
      ]);
      const [logs, providers, stats] = await Promise.all([logResponse.json(), providerResponse.json(), statsResponse.json()]);
      setSnapshot({ logs: logResponse.ok ? logs.logs || [] : [], connections: providerResponse.ok ? providers.connections || [] : [], stats: statsResponse.ok ? stats : {} });
      setRefreshedAt(new Date());
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!autoRefresh) return; const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [autoRefresh, load]);

  const metrics = useMemo(() => {
    const logs = snapshot.logs;
    const now = Date.now();
    const recent = logs.filter((log) => now - new Date(log.timestamp).getTime() <= 60000);
    const failed = logs.filter((log) => log.logType === "failed");
    const latencies = logs.map((log) => Number(log.latencyMs || 0)).filter((value) => value > 0).sort((a, b) => a - b);
    const recentTokens = recent.reduce((sum, log) => sum + (log.inputTokens || 0) + (log.cacheReadTokens || 0) + (log.cacheCreationTokens || 0) + (log.outputTokens || 0), 0);
    return { qps: recent.length / 60, tps: recentTokens / 60, successRate: logs.length ? (logs.length - failed.length) / logs.length * 100 : 100, errorRate: logs.length ? failed.length / logs.length * 100 : 0, p50: percentile(latencies, 0.5), p90: percentile(latencies, 0.9), p99: percentile(latencies, 0.99), max: latencies.at(-1) || 0, average: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0 };
  }, [snapshot.logs]);

  const trend = useMemo(() => {
    const now = Date.now();
    return Array.from({ length: 12 }, (_, index) => {
      const start = now - (12 - index) * 5 * 60000;
      const end = start + 5 * 60000;
      const rows = snapshot.logs.filter((log) => { const time = new Date(log.timestamp).getTime(); return time >= start && time < end; });
      return { label: new Date(start).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }), requests: rows.length, tokens: rows.reduce((sum, log) => sum + (log.inputTokens || 0) + (log.cacheReadTokens || 0) + (log.cacheCreationTokens || 0) + (log.outputTokens || 0), 0), errors: rows.filter((log) => log.logType === "failed").length };
    });
  }, [snapshot.logs]);

  const latencyDistribution = useMemo(() => {
    const buckets = [{ label: "0-100ms", min: 0, max: 100 }, { label: "100-500ms", min: 100, max: 500 }, { label: "0.5-1s", min: 500, max: 1000 }, { label: "1-5s", min: 1000, max: 5000 }, { label: "5s+", min: 5000, max: Infinity }];
    return buckets.map((bucket) => ({ label: bucket.label, count: snapshot.logs.filter((log) => log.latencyMs >= bucket.min && log.latencyMs < bucket.max).length }));
  }, [snapshot.logs]);

  const providerRows = useMemo(() => {
    const groups = new Map();
    snapshot.connections.forEach((connection) => { const key = connection.providerName || connection.provider; const item = groups.get(key) || { name: key, total: 0, enabled: 0, autoDisabled: 0, updatedAt: "" }; item.total += 1; item.enabled += connection.isActive !== false ? 1 : 0; item.autoDisabled += connection.autoDisabled === true ? 1 : 0; if (!item.updatedAt || new Date(connection.updatedAt) > new Date(item.updatedAt)) item.updatedAt = connection.updatedAt; groups.set(key, item); });
    return [...groups.values()];
  }, [snapshot.connections]);
  const autoDisabledCount = snapshot.connections.filter((connection) => connection.autoDisabled === true).length;
  const health = metrics.errorRate >= 20 || autoDisabledCount > 0
    ? { label: "运行状态异常", dot: "bg-red-500", text: "text-red-600" }
    : metrics.errorRate > 0
      ? { label: "运行状态有告警", dot: "bg-amber-500", text: "text-amber-600" }
      : { label: "运行状态正常", dot: "bg-emerald-500", text: "text-emerald-600" };

  return <div className="flex min-w-0 flex-col gap-4" data-i18n-skip>
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className={`size-2 rounded-full ${health.dot}`}/><div><p className={`font-semibold ${health.text}`}>{health.label}</p><p className="text-xs text-text-muted">最近刷新：{refreshedAt ? refreshedAt.toLocaleString("zh-CN") : "等待首次刷新"}</p></div></div><div className="flex items-center gap-2"><label className="flex h-10 items-center gap-2 rounded-md border border-border bg-bg-base px-3 text-sm"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)}/>自动刷新</label><Button variant="secondary" icon="refresh" loading={loading} onClick={load}>刷新</Button></div></Card>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="实时吞吐" value={`${metrics.qps.toFixed(2)} QPS`} detail={`${metrics.tps.toFixed(1)} TPS`} color="text-blue-500"/><Stat label="成功率" value={`${metrics.successRate.toFixed(3)}%`} detail={`${snapshot.logs.length} 条最近请求`} color="text-emerald-500"/><Stat label="错误率" value={`${metrics.errorRate.toFixed(2)}%`} detail={`${snapshot.logs.filter((log) => log.logType === "failed").length} 条失败`} color={metrics.errorRate ? "text-red-500" : "text-emerald-500"}/><Stat label="请求延迟" value={`${fmt(metrics.p99)} ms`} detail={`P50 ${fmt(metrics.p50)} · P90 ${fmt(metrics.p90)} · 平均 ${fmt(metrics.average)}`} color="text-rose-500"/></div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]"><Card className="p-4"><h3 className="mb-4 font-semibold">提供商状态</h3><div className="flex flex-col gap-2">{providerRows.length ? providerRows.map((item) => <div key={item.name} className="rounded-md border border-border bg-bg-base p-3"><div className="flex items-center justify-between gap-3"><span className="truncate font-medium">{item.name}</span><span className={`rounded-full px-2 py-0.5 text-xs ${item.autoDisabled ? "bg-amber-500/10 text-amber-600" : item.enabled ? "bg-emerald-500/10 text-emerald-600" : "bg-surface-2 text-text-muted"}`}>{item.autoDisabled ? "自动禁用" : item.enabled ? "已启用" : "已禁用"}</span></div><p className="mt-2 text-xs text-text-muted">账户 {item.enabled}/{item.total} · 最后修改 {item.updatedAt ? new Date(item.updatedAt).toLocaleString("zh-CN") : "-"}</p></div>) : <p className="py-12 text-center text-sm text-text-muted">暂无已配置提供商</p>}</div></Card><Card className="p-4"><h3 className="mb-4 font-semibold">吞吐趋势</h3><ResponsiveContainer width="100%" height={300}><AreaChart data={trend}><defs><linearGradient id="monitorTokens" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/><stop offset="95%" stopColor="#10b981" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12}/><XAxis dataKey="label" tick={{ fontSize: 11 }}/><YAxis yAxisId="left" tick={{ fontSize: 11 }}/><YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }}/><Tooltip/><Area yAxisId="right" type="monotone" dataKey="tokens" name="Token" stroke="#10b981" fill="url(#monitorTokens)"/><Line yAxisId="left" type="monotone" dataKey="requests" name="请求" stroke="#3b82f6" strokeWidth={2}/></AreaChart></ResponsiveContainer></Card></div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2"><Card className="p-4"><h3 className="mb-4 font-semibold">请求时长分布</h3><ResponsiveContainer width="100%" height={260}><BarChart data={latencyDistribution}><CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12}/><XAxis dataKey="label" tick={{ fontSize: 11 }}/><YAxis allowDecimals={false} tick={{ fontSize: 11 }}/><Tooltip/><Bar dataKey="count" name="请求数" fill="#3b82f6" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></Card><Card className="p-4"><h3 className="mb-4 font-semibold">错误趋势</h3>{trend.some((item) => item.errors) ? <ResponsiveContainer width="100%" height={260}><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12}/><XAxis dataKey="label" tick={{ fontSize: 11 }}/><YAxis allowDecimals={false} tick={{ fontSize: 11 }}/><Tooltip/><Line type="monotone" dataKey="errors" name="错误" stroke="#ef4444" strokeWidth={2}/></LineChart></ResponsiveContainer> : <div className="flex h-[260px] flex-col items-center justify-center text-text-muted"><span className="material-symbols-outlined mb-2 text-4xl">check_circle</span><p>最近一小时没有错误</p></div>}</Card></div>
  </div>;
}
