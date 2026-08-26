"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card, DropdownSelect } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
const PERIODS = [{ value: "24h", label: "近 24 小时" }, { value: "7d", label: "近 7 天" }, { value: "30d", label: "近 30 天" }];
const fmt = (value) => new Intl.NumberFormat("zh-CN", { notation: Number(value) >= 1000000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(value || 0);
const money = (value) => `$${Number(value || 0).toFixed(value >= 100 ? 0 : value >= 1 ? 2 : 4)}`;

function MetricCard({ icon, label, value, detail, tone = "text-primary" }) {
  return <Card padding="sm" className="flex min-h-24 items-center gap-3"><div className={`flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-2 ${tone}`}><span className="material-symbols-outlined text-[21px]">{icon}</span></div><div className="min-w-0"><p className="text-xs text-text-muted">{label}</p><p className="mt-0.5 text-xl font-semibold tabular-nums sm:text-2xl">{value}</p><p className="mt-0.5 truncate text-xs text-text-muted">{detail}</p></div></Card>;
}

function ChartTooltip({ active, payload, label, valueFormatter = fmt }) {
  if (!active || !payload?.length) return null;
  return <div className="min-w-36 rounded-md border border-border bg-surface px-3 py-2 shadow-xl"><p className="mb-1.5 text-xs font-medium text-text-muted">{label}</p>{payload.filter((item) => item.value != null).map((item) => <div key={item.dataKey} className="flex items-center justify-between gap-4 text-xs"><span className="flex min-w-0 items-center gap-1.5"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><span className="truncate">{item.name}</span></span><span className="font-semibold tabular-nums">{valueFormatter(item.value, item.name)}</span></div>)}</div>;
}

function EmptyChart({ icon = "monitoring", text }) {
  return <div className="flex h-[260px] flex-col items-center justify-center text-text-muted"><span className="material-symbols-outlined mb-2 text-3xl">{icon}</span><p className="text-sm">{text}</p></div>;
}

export default function DashboardOverviewClient() {
  const notifyError = useNotificationStore((state) => state.error);
  const notifyWarning = useNotificationStore((state) => state.warning);
  const [period, setPeriod] = useState("24h");
  const [data, setData] = useState({ stats: {}, chart: [], keys: [], connections: [], keyChart: { data: [], series: [] } });
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const responses = await Promise.all([
        fetch(`/api/usage/stats?period=${period}`, { cache: "no-store" }),
        fetch(`/api/usage/chart?period=${period}`, { cache: "no-store" }),
        fetch("/api/keys", { cache: "no-store" }),
        fetch("/api/providers", { cache: "no-store" }),
        fetch(`/api/usage/dimension-chart?period=${period}&dimension=apiKey&metric=tokens`, { cache: "no-store" }),
      ]);
      const [stats, chart, keys, providers, keyChart] = await Promise.all(responses.map((response) => response.json()));
      setData({ stats: responses[0].ok ? stats : {}, chart: responses[1].ok ? chart : [], keys: responses[2].ok ? keys.keys || [] : [], connections: responses[3].ok ? providers.connections || [] : [], keyChart: responses[4].ok ? keyChart : { data: [], series: [] } });
      if (responses.some((response) => !response.ok)) notifyWarning("部分仪表盘数据加载失败");
    } catch (error) {
      notifyError(error.message || "仪表盘数据加载失败");
    } finally { setLoading(false); }
  }, [notifyError, notifyWarning, period]);
  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const stats = data.stats || {};
  const tokenTotals = useMemo(() => Object.values(stats.byProvider || {}).reduce((total, item) => ({ input: total.input + Number(item.promptTokens || 0), cacheRead: total.cacheRead + Number(item.cachedTokens || 0), cacheWrite: total.cacheWrite + Number(item.cacheCreationTokens || 0), output: total.output + Number(item.completionTokens || 0) }), { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }), [stats.byProvider]);
  const totalTokens = tokenTotals.input + tokenTotals.cacheRead + tokenTotals.cacheWrite + tokenTotals.output;
  const modelRows = useMemo(() => Object.entries(stats.byModel || {}).map(([name, item]) => {
    const inputTokens = Number(item.promptTokens || 0) + Number(item.cachedTokens || 0) + Number(item.cacheCreationTokens || 0);
    return {
      name: item.rawModel || name.split(" (")[0],
      requests: item.requests || 0,
      cacheHitRate: inputTokens > 0 ? Number(item.cachedTokens || 0) / inputTokens * 100 : 0,
      tokens: inputTokens + Number(item.completionTokens || 0),
      cost: item.cost || 0,
    };
  }).sort((a, b) => b.tokens - a.tokens).slice(0, 7), [stats.byModel]);
  const pieData = modelRows.filter((item) => item.tokens > 0).slice(0, 6);
  const hasTokenTrend = data.chart.some((item) => Number(item.tokens) > 0);
  const hasKeyTrend = data.keyChart?.series?.length && data.keyChart.data.some((point) => data.keyChart.series.some((series) => Number(point[series.id]) > 0));
  const periodLabel = PERIODS.find((item) => item.value === period)?.label || period;

  return <div className="flex min-w-0 flex-col gap-4" data-i18n-skip>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon="key" label="API 密钥" value={data.keys.length} detail={`${data.keys.filter((item) => item.isActive !== false).length} 个启用`} />
      <MetricCard icon="dns" label="提供商账户" value={data.connections.length} detail={`${data.connections.filter((item) => item.isActive !== false).length} 个启用`} tone="text-violet-500" />
      <MetricCard icon="monitoring" label="请求总数" value={fmt(stats.totalRequests)} detail={`当前范围：${periodLabel}`} tone="text-emerald-500" />
      <MetricCard icon="paid" label="预估成本" value={money(stats.totalCost)} detail="按模型定价规则计算" tone="text-amber-500" />
      <MetricCard icon="input" label="输入 Token" value={fmt(tokenTotals.input)} detail="不含缓存读取与写入" tone="text-blue-500" />
      <MetricCard icon="cached" label="缓存 Token" value={fmt(tokenTotals.cacheRead + tokenTotals.cacheWrite)} detail={`读取 ${fmt(tokenTotals.cacheRead)} · 写入 ${fmt(tokenTotals.cacheWrite)}`} tone="text-cyan-500" />
      <MetricCard icon="output" label="输出 Token" value={fmt(tokenTotals.output)} detail={`总计 ${fmt(totalTokens)}`} tone="text-emerald-500" />
      <MetricCard icon="speed" label="平均每请求 Token" value={fmt(stats.totalRequests ? totalTokens / stats.totalRequests : 0)} detail={`${Object.keys(stats.byModel || {}).length} 个使用中模型`} tone="text-rose-500" />
    </div>

    <Card padding="sm" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap gap-2"><Link href="/dashboard/key-groups"><Button variant="secondary" icon="group_work">密钥分组</Button></Link><Link href="/dashboard/settings/pricing"><Button variant="secondary" icon="paid">模型定价</Button></Link><Link href="/dashboard/usage"><Button variant="secondary" icon="bar_chart">流量分析</Button></Link></div><div className="flex items-center gap-2"><DropdownSelect className="w-36" buttonClassName="h-9" value={period} options={PERIODS} onChange={setPeriod} /><Button variant="secondary" icon="refresh" loading={loading} onClick={load}>刷新</Button></div></Card>

    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      <Card padding="sm" className="min-w-0"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">模型分布</h3><span className="text-xs text-text-muted">按 Token 排序</span></div>{pieData.length ? <div className="grid items-center gap-3 lg:grid-cols-[190px_minmax(0,1fr)]"><div className="relative h-[220px]"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="tokens" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={3} stroke="none">{pieData.map((item, index) => <Cell key={item.name} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip content={<ChartTooltip />} /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-semibold">{pieData.length}</span><span className="text-xs text-text-muted">主要模型</span></div></div><div className="min-w-0 overflow-x-auto"><div className="min-w-[460px]"><div className="grid grid-cols-[minmax(0,1fr)_56px_72px_64px_76px] gap-2 border-b border-border pb-2 text-xs text-text-muted"><span>模型</span><span className="text-right">请求</span><span className="text-right">缓存命中</span><span className="text-right">Token</span><span className="text-right">成本</span></div>{modelRows.map((item, index) => <div key={item.name} className="grid grid-cols-[minmax(0,1fr)_56px_72px_64px_76px] items-center gap-2 border-b border-border/50 py-2 last:border-0"><span className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} /><span className="truncate font-mono text-xs" title={item.name}>{item.name}</span></span><span className="text-right text-xs tabular-nums">{fmt(item.requests)}</span><span className="text-right text-xs tabular-nums">{item.cacheHitRate.toFixed(2)}%</span><span className="text-right text-xs tabular-nums">{fmt(item.tokens)}</span><span className="text-right text-xs font-medium tabular-nums text-emerald-600">{money(item.cost)}</span></div>)}</div></div></div> : <EmptyChart icon="donut_large" text="当前范围内暂无模型使用数据" />}</Card>

      <Card padding="sm" className="min-w-0"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Token 使用趋势</h3><span className="text-xs text-text-muted">{periodLabel}</span></div>{hasTokenTrend ? <ResponsiveContainer width="100%" height={300}><LineChart data={data.chart} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}><CartesianGrid vertical={false} strokeDasharray="4 4" strokeOpacity={0.14}/><XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={10} minTickGap={32} tick={{ fontSize: 11 }}/><YAxis yAxisId="tokens" axisLine={false} tickLine={false} tickMargin={8} tickFormatter={fmt} tick={{ fontSize: 11 }} width={58}/><YAxis yAxisId="rate" orientation="right" domain={[0, 100]} axisLine={false} tickLine={false} tickMargin={8} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 11 }} width={42}/><Tooltip content={<ChartTooltip valueFormatter={(value, name) => name === "缓存命中率" ? `${Number(value).toFixed(2)}%` : fmt(value)} />} /><Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} /><Line yAxisId="tokens" type="monotone" dataKey="inputTokens" name="输入" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 3 }} /><Line yAxisId="tokens" type="monotone" dataKey="outputTokens" name="输出" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 3 }} /><Line yAxisId="tokens" type="monotone" dataKey="cacheCreationTokens" name="缓存写入" stroke="#f59e0b" strokeWidth={2} dot={false} activeDot={{ r: 3 }} /><Line yAxisId="tokens" type="monotone" dataKey="cacheReadTokens" name="缓存读取" stroke="#06b6d4" strokeWidth={2.5} dot={false} activeDot={{ r: 3 }} /><Line yAxisId="rate" type="monotone" dataKey="cacheHitRate" name="缓存命中率" stroke="#8b5cf6" strokeWidth={2} strokeDasharray="4 3" dot={false} activeDot={{ r: 3 }} /></LineChart></ResponsiveContainer> : <EmptyChart text="当前范围内暂无 Token 使用数据" />}</Card>
    </div>

    <Card padding="sm" className="min-w-0"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">密钥使用趋势</h3><span className="text-xs text-text-muted">显示用量最高的密钥</span></div>{hasKeyTrend ? <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_190px]"><div className="min-w-0"><ResponsiveContainer width="100%" height={290}><LineChart data={data.keyChart.data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><CartesianGrid vertical={false} strokeDasharray="4 4" strokeOpacity={0.14}/><XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={10} minTickGap={30} tick={{ fontSize: 11 }}/><YAxis axisLine={false} tickLine={false} tickMargin={8} tickFormatter={fmt} tick={{ fontSize: 11 }} width={58}/><Tooltip content={<ChartTooltip />} />{data.keyChart.series.map((series, index) => <Line key={series.id} type="monotone" dataKey={series.id} name={series.label} stroke={COLORS[index % COLORS.length]} strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />)}</LineChart></ResponsiveContainer></div><div className="flex flex-wrap content-center gap-x-4 gap-y-2 border-t border-border/60 pt-3 text-xs lg:flex-col lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">{data.keyChart.series.map((series, index) => <div key={series.id} className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} /><span className="truncate" title={series.label}>{series.label}</span></div>)}</div></div> : <EmptyChart icon="key" text="当前范围内暂无密钥使用数据" />}</Card>
  </div>;
}
