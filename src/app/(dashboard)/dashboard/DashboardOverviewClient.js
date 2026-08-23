"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Card } from "@/shared/components";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];
const fmt = (value) => new Intl.NumberFormat("zh-CN", { notation: value >= 1000000 ? "compact" : "standard", maximumFractionDigits: 2 }).format(value || 0);
const money = (value) => `$${Number(value || 0).toFixed(value >= 100 ? 0 : value >= 1 ? 2 : 4)}`;

function MetricCard({ icon, label, value, detail, tone = "text-primary" }) {
  return <Card className="flex min-h-24 items-center gap-4 p-4"><div className={`flex size-11 shrink-0 items-center justify-center rounded-md bg-surface-2 ${tone}`}><span className="material-symbols-outlined">{icon}</span></div><div className="min-w-0"><p className="text-sm text-text-muted">{label}</p><p className="truncate text-2xl font-semibold tabular-nums">{value}</p><p className="truncate text-xs text-text-muted">{detail}</p></div></Card>;
}

export default function DashboardOverviewClient() {
  const [period, setPeriod] = useState("24h");
  const [data, setData] = useState({ stats: {}, chart: [], keys: [], connections: [], keyChart: { data: [], series: [] } });
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const responses = await Promise.all([
        fetch(`/api/usage/stats?period=${period}`, { cache: "no-store" }), fetch(`/api/usage/chart?period=${period}`, { cache: "no-store" }),
        fetch("/api/keys", { cache: "no-store" }), fetch("/api/providers", { cache: "no-store" }),
        fetch(`/api/usage/dimension-chart?period=${period}&dimension=apiKey&metric=tokens`, { cache: "no-store" }),
      ]);
      const [stats, chart, keys, providers, keyChart] = await Promise.all(responses.map((response) => response.json()));
      setData({ stats: responses[0].ok ? stats : {}, chart: responses[1].ok ? chart : [], keys: responses[2].ok ? keys.keys || [] : [], connections: responses[3].ok ? providers.connections || [] : [], keyChart: responses[4].ok ? keyChart : { data: [], series: [] } });
    } finally { setLoading(false); }
  }, [period]);
  useEffect(() => { load(); }, [load]);

  const stats = data.stats || {};
  const tokenTotals = useMemo(() => Object.values(stats.byProvider || {}).reduce((total, item) => ({
    input: total.input + Number(item.promptTokens || 0),
    cacheRead: total.cacheRead + Number(item.cachedTokens || 0),
    cacheWrite: total.cacheWrite + Number(item.cacheCreationTokens || 0),
    output: total.output + Number(item.completionTokens || 0),
  }), { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }), [stats.byProvider]);
  const totalTokens = tokenTotals.input + tokenTotals.cacheRead + tokenTotals.cacheWrite + tokenTotals.output;
  const modelRows = useMemo(() => Object.entries(stats.byModel || {}).map(([name, item]) => ({ name: item.rawModel || name.split(" (")[0], requests: item.requests || 0, tokens: (item.promptTokens || 0) + (item.cachedTokens || 0) + (item.cacheCreationTokens || 0) + (item.completionTokens || 0), cost: item.cost || 0 })).sort((a, b) => b.tokens - a.tokens).slice(0, 8), [stats.byModel]);
  const pieData = modelRows.filter((item) => item.tokens > 0).slice(0, 6);

  return <div className="flex min-w-0 flex-col gap-5" data-i18n-skip>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard icon="key" label="API 密钥" value={data.keys.length} detail={`${data.keys.filter((item) => item.isActive !== false).length} 个启用`} />
      <MetricCard icon="dns" label="提供商账户" value={data.connections.length} detail={`${data.connections.filter((item) => item.isActive !== false).length} 个启用`} tone="text-violet-500" />
      <MetricCard icon="monitoring" label="请求总数" value={fmt(stats.totalRequests)} detail={`当前范围：${period === "24h" ? "近 24 小时" : period === "7d" ? "近 7 天" : "近 30 天"}`} tone="text-emerald-500" />
      <MetricCard icon="paid" label="预估成本" value={money(stats.totalCost)} detail="按模型定价规则计算" tone="text-amber-500" />
      <MetricCard icon="input" label="输入 Token" value={fmt(tokenTotals.input)} detail="不含缓存读取与写入" tone="text-blue-500" />
      <MetricCard icon="cached" label="缓存 Token" value={fmt(tokenTotals.cacheRead + tokenTotals.cacheWrite)} detail={`读取 ${fmt(tokenTotals.cacheRead)} · 写入 ${fmt(tokenTotals.cacheWrite)}`} tone="text-cyan-500" />
      <MetricCard icon="output" label="输出 Token" value={fmt(tokenTotals.output)} detail={`总计 ${fmt(totalTokens)}`} tone="text-emerald-500" />
      <MetricCard icon="speed" label="平均每请求 Token" value={fmt(stats.totalRequests ? totalTokens / stats.totalRequests : 0)} detail={`${Object.keys(stats.byModel || {}).length} 个使用中模型`} tone="text-rose-500" />
    </div>
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex flex-wrap gap-2"><Link href="/dashboard/key-groups"><Button variant="secondary" icon="group_work">密钥分组</Button></Link><Link href="/dashboard/settings/pricing"><Button variant="secondary" icon="paid">模型定价</Button></Link><Link href="/dashboard/usage"><Button variant="secondary" icon="bar_chart">流量分析</Button></Link></div><div className="flex items-center gap-2"><select className="h-10 rounded-md border border-border bg-bg-base px-3 text-sm" value={period} onChange={(event) => setPeriod(event.target.value)}><option value="24h">近 24 小时</option><option value="7d">近 7 天</option><option value="30d">近 30 天</option></select><Button variant="secondary" icon="refresh" loading={loading} onClick={load}>刷新</Button></div></Card>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card className="min-w-0 p-4"><h3 className="mb-4 font-semibold">模型分布</h3><div className="grid min-h-[300px] grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">{pieData.length ? <ResponsiveContainer width="100%" height={260}><PieChart><Pie data={pieData} dataKey="tokens" nameKey="name" innerRadius={65} outerRadius={100} paddingAngle={2}>{pieData.map((item, index) => <Cell key={item.name} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={(value) => fmt(value)} /></PieChart></ResponsiveContainer> : <div className="flex items-center justify-center text-sm text-text-muted">暂无模型使用数据</div>}<div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm"><thead className="text-text-muted"><tr><th className="pb-2 text-left">模型</th><th className="pb-2 text-right">请求</th><th className="pb-2 text-right">Token</th><th className="pb-2 text-right">成本</th></tr></thead><tbody className="divide-y divide-border/60">{modelRows.map((item) => <tr key={item.name}><td className="max-w-48 truncate py-2 font-mono text-xs">{item.name}</td><td className="py-2 text-right">{fmt(item.requests)}</td><td className="py-2 text-right">{fmt(item.tokens)}</td><td className="py-2 text-right text-emerald-600">{money(item.cost)}</td></tr>)}</tbody></table></div></div></Card>
      <Card className="min-w-0 p-4"><h3 className="mb-4 font-semibold">Token 使用趋势</h3><ResponsiveContainer width="100%" height={300}><AreaChart data={data.chart}><defs><linearGradient id="dashboardTokens" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3}/><stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12}/><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tickFormatter={fmt} tick={{ fontSize: 11 }} width={55}/><Tooltip formatter={(value, name) => name === "tokens" ? [fmt(value), "Token"] : [money(value), "成本"]}/><Area type="monotone" dataKey="tokens" stroke="#06b6d4" strokeWidth={2} fill="url(#dashboardTokens)" /></AreaChart></ResponsiveContainer></Card>
    </div>
    <Card className="min-w-0 p-4"><h3 className="mb-4 font-semibold">密钥使用趋势</h3>{data.keyChart?.series?.length ? <ResponsiveContainer width="100%" height={320}><LineChart data={data.keyChart.data}><CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12}/><XAxis dataKey="label" tick={{ fontSize: 11 }}/><YAxis tickFormatter={fmt} tick={{ fontSize: 11 }} width={55}/><Tooltip formatter={(value) => fmt(value)}/>{data.keyChart.series.map((series, index) => <Line key={series.id} type="monotone" dataKey={series.id} name={series.label} stroke={COLORS[index % COLORS.length]} strokeWidth={2} dot={false}/>)}</LineChart></ResponsiveContainer> : <div className="flex h-64 items-center justify-center text-sm text-text-muted">暂无密钥使用数据</div>}</Card>
  </div>;
}
