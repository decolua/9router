"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, SegmentedControl, Toggle } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const fmt = (value) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value || 0);
const percentile = (values, rate) => values.length ? values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * rate) - 1))] : 0;
const latencySummary = (values) => {
  const sorted = values.map(Number).filter((value) => value > 0).sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p99: percentile(sorted, 0.99),
    average: sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : 0,
  };
};

function Stat({ icon, label, value, detail, color = "text-text-main" }) {
  return <Card padding="sm" className="flex min-h-24 items-center gap-3"><div className={`flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-2 ${color}`}><span className="material-symbols-outlined text-[21px]">{icon}</span></div><div className="min-w-0"><p className="text-xs text-text-muted">{label}</p><p className={`mt-0.5 text-xl font-semibold tabular-nums ${color}`}>{value}</p><p className="mt-0.5 truncate text-xs text-text-muted">{detail}</p></div></Card>;
}

function ChartTooltip({ active, payload, label, suffix = "" }) {
  if (!active || !payload?.length) return null;
  return <div className="min-w-36 rounded-md border border-border bg-surface px-3 py-2 shadow-xl"><p className="mb-1.5 text-xs font-medium text-text-muted">{label}</p>{payload.filter((item) => item.value != null).map((item) => <div key={item.dataKey} className="flex items-center justify-between gap-4 text-xs"><span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</span><span className="font-semibold tabular-nums">{fmt(item.value)}{suffix}</span></div>)}</div>;
}

function EmptyChart({ icon, text }) {
  return <div className="flex h-[230px] flex-col items-center justify-center text-text-muted"><span className="material-symbols-outlined mb-2 text-3xl">{icon}</span><p className="text-sm">{text}</p></div>;
}

export default function SystemMonitorClient() {
  const notifyError = useNotificationStore((state) => state.error);
  const notifyWarning = useNotificationStore((state) => state.warning);
  const [snapshot, setSnapshot] = useState({ logs: [], connections: [], settings: {}, system: null });
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [latencyMode, setLatencyMode] = useState("ttft");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 60 * 60 * 1000);
      const [logResponse, providerResponse, settingsResponse, systemResponse] = await Promise.all([
        fetch(`/api/usage/request-logs?page=1&pageSize=200&startDate=${encodeURIComponent(start.toISOString())}&endDate=${encodeURIComponent(end.toISOString())}`, { cache: "no-store" }),
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
        fetch("/api/system/metrics", { cache: "no-store" }),
      ]);
      const [logs, providers, settings, system] = await Promise.all([logResponse.json(), providerResponse.json(), settingsResponse.json(), systemResponse.json()]);
      setSnapshot({ logs: logResponse.ok ? logs.logs || [] : [], connections: providerResponse.ok ? providers.connections || [] : [], settings: settingsResponse.ok ? settings : {}, system: systemResponse.ok ? system : null });
      setRefreshedAt(end.getTime());
      if (!logResponse.ok || !providerResponse.ok || !settingsResponse.ok || !systemResponse.ok) notifyWarning("部分监控数据加载失败");
    } catch (error) {
      notifyError(error.message || "系统监控数据加载失败");
    } finally { setLoading(false); }
  }, [notifyError, notifyWarning]);

  useEffect(() => { const timeout = setTimeout(load, 0); return () => clearTimeout(timeout); }, [load]);
  useEffect(() => { if (!autoRefresh) return; const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [autoRefresh, load]);

  const metrics = useMemo(() => {
    const logs = snapshot.logs;
    const now = refreshedAt || 0;
    const recent = logs.filter((log) => now - new Date(log.timestamp).getTime() <= 60000);
    const failed = logs.filter((log) => log.logType === "failed");
    const recentTokens = recent.reduce((sum, log) => sum + (log.inputTokens || 0) + (log.cacheReadTokens || 0) + (log.cacheCreationTokens || 0) + (log.outputTokens || 0), 0);
    return {
      qps: recent.length / 60,
      tps: recentTokens / 60,
      successRate: logs.length ? (logs.length - failed.length) / logs.length * 100 : null,
      errorRate: logs.length ? failed.length / logs.length * 100 : null,
      ttft: latencySummary(logs.map((log) => log.ttftMs)),
      total: latencySummary(logs.map((log) => log.latencyMs)),
    };
  }, [refreshedAt, snapshot.logs]);

  const trend = useMemo(() => {
    const now = refreshedAt || 0;
    return Array.from({ length: 12 }, (_, index) => {
      const start = now - (12 - index) * 5 * 60000;
      const end = start + 5 * 60000;
      const rows = snapshot.logs.filter((log) => { const time = new Date(log.timestamp).getTime(); return time >= start && time < end; });
      return { label: new Date(start).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }), requests: rows.length, tokens: rows.reduce((sum, log) => sum + (log.inputTokens || 0) + (log.cacheReadTokens || 0) + (log.cacheCreationTokens || 0) + (log.outputTokens || 0), 0), errors: rows.filter((log) => log.logType === "failed").length };
    });
  }, [refreshedAt, snapshot.logs]);

  const latencyDistribution = useMemo(() => {
    const buckets = [{ label: "0-100ms", min: 0, max: 100 }, { label: "100-500ms", min: 100, max: 500 }, { label: "0.5-1s", min: 500, max: 1000 }, { label: "1-5s", min: 1000, max: 5000 }, { label: "5s+", min: 5000, max: Infinity }];
    const field = latencyMode === "ttft" ? "ttftMs" : "latencyMs";
    return buckets.map((bucket) => ({ label: bucket.label, count: snapshot.logs.filter((log) => log[field] > 0 && log[field] >= bucket.min && log[field] < bucket.max).length }));
  }, [latencyMode, snapshot.logs]);

  const providerRows = useMemo(() => {
    const groups = new Map();
    snapshot.connections.forEach((connection) => {
      const key = connection.provider;
      const item = groups.get(key) || { id: key, name: connection.providerName || key, total: 0, enabled: 0, autoDisabled: 0, autoDisabledConnections: [], updatedAt: "" };
      item.total += 1;
      item.enabled += connection.isActive !== false ? 1 : 0;
      item.autoDisabled += connection.autoDisabled === true ? 1 : 0;
      if (connection.autoDisabled === true) {
        item.autoDisabledConnections.push({
          id: connection.id,
          name: connection.name || connection.email || connection.id,
          reason: connection.autoDisabledReason || "命中自动禁用规则",
        });
      }
      if (!item.updatedAt || new Date(connection.updatedAt) > new Date(item.updatedAt)) item.updatedAt = connection.updatedAt;
      groups.set(key, item);
    });
    snapshot.logs.forEach((log) => {
      const key = log.providerId || log.provider;
      const item = groups.get(key) || { id: key, name: log.provider || key, total: 0, enabled: 0, autoDisabled: 0, autoDisabledConnections: [], updatedAt: "" };
      if (!item.logs) item.logs = [];
      item.logs.push(log);
      groups.set(key, item);
    });
    return [...groups.values()].map((item) => {
      const logs = item.logs || [];
      const failed = logs.filter((log) => log.logType === "failed").length;
      const override = snapshot.settings.providerStrategies?.[item.id] || {};
      const strategy = override.fallbackStrategy || snapshot.settings.fallbackStrategy || "fill-first";
      const stickyLimit = override.stickyRoundRobinLimit || snapshot.settings.stickyRoundRobinLimit || 3;
      return {
        ...item,
        requests: logs.length,
        successRate: logs.length ? (logs.length - failed) / logs.length * 100 : null,
        ttft: latencySummary(logs.map((log) => log.ttftMs)),
        totalLatency: latencySummary(logs.map((log) => log.latencyMs)),
        strategy,
        stickyLimit,
        routingWarning: item.enabled > 1 && strategy !== "round-robin",
      };
    }).sort((a, b) => b.autoDisabled - a.autoDisabled || b.requests - a.requests || b.enabled - a.enabled || a.name.localeCompare(b.name));
  }, [snapshot.connections, snapshot.logs, snapshot.settings]);

  const autoDisabledCount = snapshot.connections.filter((connection) => connection.autoDisabled === true).length;
  const autoDisableHistory = useMemo(() => {
    const history = Array.isArray(snapshot.settings.providerAutoDisableHistory)
      ? snapshot.settings.providerAutoDisableHistory
      : [];
    const syntheticEvents = snapshot.connections
      .filter((connection) => connection.autoDisabled === true)
      .filter((connection) => {
        const disabledAt = new Date(connection.autoDisabledAt || 0).getTime();
        return !history.some((event) => (
          event.type === "disabled"
          && event.connectionId === connection.id
          && (!disabledAt || new Date(event.timestamp).getTime() >= disabledAt)
        ));
      })
      .map((connection) => ({
        id: `current-${connection.id}`,
        type: "disabled",
        timestamp: connection.autoDisabledAt || connection.updatedAt || new Date(0).toISOString(),
        provider: connection.providerName || connection.provider,
        connectionId: connection.id,
        connectionName: connection.name || connection.email || connection.id,
        reason: connection.autoDisabledReason || "命中自动禁用规则",
      }));
    return [...history, ...syntheticEvents]
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
      .slice(0, 20);
  }, [snapshot.connections, snapshot.settings.providerAutoDisableHistory]);
  const hasTraffic = trend.some((item) => item.requests > 0 || item.tokens > 0);
  const hasLatency = latencyDistribution.some((item) => item.count > 0);
  const hasErrors = trend.some((item) => item.errors > 0);
  const system = snapshot.system;
  const bytesToGiB = (value) => `${(Number(value || 0) / 1024 ** 3).toFixed(2)} GiB`;
  const health = !snapshot.logs.length
    ? { label: "运行中，暂无流量", dot: "bg-blue-500", text: "text-blue-600" }
    : (metrics.errorRate >= 20 || autoDisabledCount > 0)
      ? { label: "运行状态异常", dot: "bg-red-500", text: "text-red-600" }
      : metrics.errorRate > 0
        ? { label: "运行状态有告警", dot: "bg-amber-500", text: "text-amber-600" }
        : { label: "运行状态正常", dot: "bg-emerald-500", text: "text-emerald-600" };

  return <div className="flex min-w-0 flex-col gap-4" data-i18n-skip>
    <Card padding="sm" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className={`size-2.5 rounded-full ${health.dot}`} /><div><p className={`font-semibold ${health.text}`}>{health.label}</p><p className="text-xs text-text-muted">最近刷新：{refreshedAt ? new Date(refreshedAt).toLocaleString("zh-CN") : "等待首次刷新"}</p></div></div><div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm text-text-muted"><span>自动刷新</span><Toggle size="sm" checked={autoRefresh} onChange={setAutoRefresh} /></label><Button variant="secondary" icon="refresh" loading={loading} onClick={load}>刷新</Button></div></Card>

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5"><Stat icon="speed" label="实时吞吐" value={`${metrics.qps.toFixed(2)} QPS`} detail={`${metrics.tps.toFixed(1)} TPS`} color="text-blue-500" /><Stat icon="check_circle" label="成功率" value={metrics.successRate == null ? "--" : `${metrics.successRate.toFixed(2)}%`} detail={`${snapshot.logs.length} 条最近请求`} color="text-emerald-500" /><Stat icon="error" label="错误率" value={metrics.errorRate == null ? "--" : `${metrics.errorRate.toFixed(2)}%`} detail={`${snapshot.logs.filter((log) => log.logType === "failed").length} 条失败`} color={metrics.errorRate ? "text-red-500" : "text-emerald-500"} /><Stat icon="network_ping" label="P99 首 Token 延迟" value={metrics.ttft.p99 ? `${fmt(metrics.ttft.p99)} ms` : "--"} detail={`P50 ${fmt(metrics.ttft.p50)} · P90 ${fmt(metrics.ttft.p90)} · 平均 ${fmt(metrics.ttft.average)}`} color="text-amber-500" /><Stat icon="timer" label="P99 完整响应时长" value={metrics.total.p99 ? `${fmt(metrics.total.p99)} ms` : "--"} detail={`P50 ${fmt(metrics.total.p50)} · P90 ${fmt(metrics.total.p90)} · 平均 ${fmt(metrics.total.average)}`} color="text-rose-500" /></div>

    <Card padding="sm"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold">系统资源</h3><p className="text-xs text-text-muted">仅展示当前 9Router 进程和运行环境可读取的指标</p></div><span className="text-xs text-text-muted">{system?.hostname || "-"}</span></div>{system ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat icon="memory" label="进程内存 RSS" value={bytesToGiB(system.memory?.rssBytes)} detail={`堆 ${bytesToGiB(system.memory?.heapUsedBytes)}`} color="text-cyan-500" /><Stat icon="computer" label="系统内存" value={`${((system.memory?.usedBytes || 0) / Math.max(1, system.memory?.totalBytes || 1) * 100).toFixed(1)}%`} detail={`${bytesToGiB(system.memory?.usedBytes)} / ${bytesToGiB(system.memory?.totalBytes)}`} color="text-indigo-500" /><Stat icon="schedule" label="进程运行时间" value={`${Math.floor((system.uptimeSeconds || 0) / 3600)}h`} detail={`${fmt((system.uptimeSeconds || 0) % 3600 / 60)} 分钟`} color="text-violet-500" /><Stat icon="memory" label="CPU 核心" value={fmt(system.cpuCount)} detail={`${system.platform || "未知平台"} · ${system.node || "Node"}`} color="text-teal-500" /></div> : <EmptyChart icon="memory" text="系统资源指标暂不可用" />}</Card>

    <Card padding="sm" className="min-w-0"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">吞吐趋势</h3><span className="text-xs text-text-muted">最近一小时 · 每 5 分钟</span></div>{hasTraffic ? <ResponsiveContainer width="100%" height={270}><AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><defs><linearGradient id="monitorTokens" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.25}/><stop offset="90%" stopColor="#10b981" stopOpacity={0.02}/></linearGradient><linearGradient id="monitorRequests" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={0.18}/><stop offset="90%" stopColor="#3b82f6" stopOpacity={0.01}/></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="4 4" strokeOpacity={0.14}/><XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={10} tick={{ fontSize: 11 }}/><YAxis yAxisId="requests" axisLine={false} tickLine={false} tickMargin={8} allowDecimals={false} width={40} tick={{ fontSize: 11 }}/><YAxis yAxisId="tokens" orientation="right" axisLine={false} tickLine={false} tickMargin={8} tickFormatter={fmt} width={54} tick={{ fontSize: 11 }}/><Tooltip content={<ChartTooltip />} /><Area yAxisId="tokens" type="monotone" dataKey="tokens" name="Token" stroke="#10b981" strokeWidth={2.25} fill="url(#monitorTokens)" activeDot={{ r: 4, strokeWidth: 0 }} /><Area yAxisId="requests" type="monotone" dataKey="requests" name="请求" stroke="#3b82f6" strokeWidth={2.25} fill="url(#monitorRequests)" activeDot={{ r: 4, strokeWidth: 0 }} /></AreaChart></ResponsiveContainer> : <EmptyChart icon="monitoring" text="最近一小时暂无请求流量" />}</Card>

    <Card padding="sm"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">提供商状态</h3><span className="text-xs text-text-muted">{providerRows.length} 个提供商</span></div>{providerRows.length ? <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">{providerRows.map((item) => <div key={item.id} className="rounded-md border border-border bg-bg-base px-3 py-2.5"><div className="flex items-center justify-between gap-3"><span className="truncate text-sm font-medium">{item.name}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${item.autoDisabled ? "bg-amber-500/10 text-amber-600" : item.enabled ? "bg-emerald-500/10 text-emerald-600" : "bg-surface-2 text-text-muted"}`}>{item.autoDisabled ? `自动禁用 ${item.autoDisabled}/${item.total}` : item.enabled ? "已启用" : "已禁用"}</span></div><p className="mt-1.5 text-xs text-text-muted">可用连接 {item.enabled}/{item.total} · 最近请求 {item.requests}</p>{item.autoDisabledConnections[0] && <p className="mt-1 truncate text-xs font-medium text-amber-600" title={`${item.autoDisabledConnections[0].name}: ${item.autoDisabledConnections[0].reason}`}>{item.autoDisabledConnections[0].name}：{item.autoDisabledConnections[0].reason}</p>}<p className={`mt-1 text-xs ${item.routingWarning ? "font-medium text-amber-600" : "text-text-muted"}`}>调度 {item.strategy === "round-robin" ? `轮询 · 每 ${item.stickyLimit} 次切换` : "顺序优先 · 流量集中首账号"}</p><p className="mt-1 text-xs text-text-muted">{item.requests ? `成功 ${item.successRate.toFixed(1)}% · 首 Token P90 ${item.ttft.p90 ? `${fmt(item.ttft.p90)} ms` : "暂无"} · 完成 P90 ${item.totalLatency.p90 ? `${fmt(item.totalLatency.p90)} ms` : "暂无"}` : "最近一小时暂无请求"}</p></div>)}</div> : <EmptyChart icon="dns" text="暂无已配置提供商" />}</Card>

    <Card padding="sm"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">自动禁用记录</h3><span className="text-xs text-text-muted">最近 {autoDisableHistory.length} 条</span></div>{autoDisableHistory.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="border-b border-border text-text-muted"><tr><th className="px-3 py-2 font-medium">时间</th><th className="px-3 py-2 font-medium">提供商</th><th className="px-3 py-2 font-medium">连接</th><th className="px-3 py-2 font-medium">事件</th><th className="px-3 py-2 font-medium">原因</th></tr></thead><tbody className="divide-y divide-border/60">{autoDisableHistory.map((event) => <tr key={event.id}><td className="whitespace-nowrap px-3 py-2 text-text-muted">{new Date(event.timestamp).toLocaleString("zh-CN", { hour12: false })}</td><td className="px-3 py-2">{event.provider || "-"}</td><td className="px-3 py-2">{event.connectionName || event.connectionId || "-"}</td><td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 ${event.type === "recovered" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>{event.type === "recovered" ? "自动恢复" : "自动禁用"}</span></td><td className="max-w-md truncate px-3 py-2 text-text-muted" title={event.reason}>{event.reason || "-"}</td></tr>)}</tbody></table></div> : <div className="py-8 text-center text-sm text-text-muted">暂无自动禁用记录</div>}</Card>

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2"><Card padding="sm" className="min-w-0"><div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold">延迟分布</h3><p className="text-xs text-text-muted">首 Token 反映等待体感，完整响应包含模型生成时间</p></div><SegmentedControl size="sm" value={latencyMode} onChange={setLatencyMode} options={[{ value: "ttft", label: "首 Token" }, { value: "total", label: "完整响应" }]} /></div>{hasLatency ? <ResponsiveContainer width="100%" height={240}><BarChart data={latencyDistribution} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><defs><linearGradient id="latencyBars" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b82f6" stopOpacity={0.95}/><stop offset="100%" stopColor="#06b6d4" stopOpacity={0.65}/></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="4 4" strokeOpacity={0.14}/><XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={10} tick={{ fontSize: 11 }}/><YAxis axisLine={false} tickLine={false} tickMargin={8} allowDecimals={false} width={34} tick={{ fontSize: 11 }}/><Tooltip content={<ChartTooltip />} /><Bar dataKey="count" name="请求数" fill="url(#latencyBars)" radius={[5, 5, 0, 0]} maxBarSize={54} /></BarChart></ResponsiveContainer> : <EmptyChart icon="timer_off" text={`最近一小时暂无${latencyMode === "ttft" ? "首 Token" : "完整响应"}数据`} />}</Card><Card padding="sm" className="min-w-0"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">错误趋势</h3><span className="text-xs text-text-muted">最近一小时</span></div>{hasErrors ? <ResponsiveContainer width="100%" height={240}><AreaChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><defs><linearGradient id="monitorErrors" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ef4444" stopOpacity={0.24}/><stop offset="90%" stopColor="#ef4444" stopOpacity={0.02}/></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="4 4" strokeOpacity={0.14}/><XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={10} tick={{ fontSize: 11 }}/><YAxis axisLine={false} tickLine={false} tickMargin={8} allowDecimals={false} width={34} tick={{ fontSize: 11 }}/><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="errors" name="错误" stroke="#ef4444" strokeWidth={2.25} fill="url(#monitorErrors)" activeDot={{ r: 4, strokeWidth: 0 }} /></AreaChart></ResponsiveContainer> : <EmptyChart icon="check_circle" text="最近一小时没有错误" />}</Card></div>
  </div>;
}
