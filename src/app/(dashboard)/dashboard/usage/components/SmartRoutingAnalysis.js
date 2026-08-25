"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, DropdownSelect } from "@/shared/components";

const COLORS = ["#0284c7", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];
const EMPTY_DATA = { buckets: [], series: [], totals: { requests: 0, actualCost: 0, simulatedCost: 0 }, configured: false };

export default function SmartRoutingAnalysis({ startDate, endDate, refreshToken = 0 }) {
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const requestKey = `${startDate}|${endDate}|${intervalMinutes}|${refreshToken}`;
  const [result, setResult] = useState(null);
  const data = result?.key === requestKey ? result.data : null;
  const loading = !data;

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ startDate, endDate, intervalMinutes: String(intervalMinutes) });
    fetch(`/api/usage/smart-routing?${query.toString()}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("获取分析数据失败")))
      .then((data) => { if (!cancelled) setResult({ key: requestKey, data }); })
      .catch(() => { if (!cancelled) setResult({ key: requestKey, data: EMPTY_DATA }); });
    return () => { cancelled = true; };
  }, [startDate, endDate, intervalMinutes, refreshToken, requestKey]);

  const chart = useMemo(() => (data?.buckets || []).map((bucket, index) => {
    const row = { label: bucket.label };
    (data?.series || []).forEach((series) => {
      row[`${series.id}:actual`] = series.actual[index]?.cost || 0;
      row[`${series.id}:simulated`] = series.simulated[index]?.cost || 0;
    });
    return row;
  }), [data]);
  const savings = Number(data?.totals?.actualCost || 0) - Number(data?.totals?.simulatedCost || 0);

  return (
    <div className="flex min-w-0 flex-col gap-5" data-i18n-skip>
      <div className="flex justify-end">
        <DropdownSelect className="w-40" label="聚合颗粒度" value={intervalMinutes} onChange={setIntervalMinutes} options={[{ value: 15, label: "15 分钟" }, { value: 30, label: "30 分钟" }, { value: 60, label: "1 小时" }, { value: 1440, label: "1 天" }]} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric title="路由请求" value={String(data?.totals?.requests || 0)} />
        <Metric title="真实费用" value={`$${Number(data?.totals?.actualCost || 0).toFixed(6)}`} />
        <Metric title="主力模型模拟费用" value={`$${Number(data?.totals?.simulatedCost || 0).toFixed(6)}`} hint={`差额 $${savings.toFixed(6)}`} />
      </div>

      <Card className="min-w-0">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-lg font-semibold">智能路由费用趋势</h2><span className="text-xs text-text-muted">实线为真实费用，虚线为按主力模型价格模拟的费用</span></div>
        {loading ? <div className="flex h-[420px] items-center justify-center text-text-muted">正在加载...</div> : !data?.configured ? <Empty text="请先在智能路由提供商配置中启用提供商并选择其 API 密钥。" /> : !data?.series?.length ? <Empty text="当前时间范围内没有配置主力模型的智能路由请求。" /> : (
          <div className="h-[440px] min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ top: 12, right: 18, left: 4, bottom: 12 }}><CartesianGrid strokeDasharray="3 3" stroke="var(--border)" /><XAxis dataKey="label" minTickGap={32} tick={{ fontSize: 11, fill: "var(--text-muted)" }} /><YAxis tickFormatter={(value) => `$${Number(value).toFixed(4)}`} tick={{ fontSize: 11, fill: "var(--text-muted)" }} width={78} /><Tooltip formatter={(value) => `$${Number(value).toFixed(8)}`} /><Legend wrapperStyle={{ fontSize: 12, lineHeight: "20px" }} />{data.series.flatMap((series, index) => { const color = COLORS[index % COLORS.length]; const label = `${series.providerName}/${series.model}`; return [<Line key={`${series.id}:actual`} type="monotone" dataKey={`${series.id}:actual`} name={`${label} 真实`} stroke={color} strokeWidth={2} dot={false} />, <Line key={`${series.id}:simulated`} type="monotone" dataKey={`${series.id}:simulated`} name={`${label} 主力模拟`} stroke={color} strokeWidth={2} strokeDasharray="7 5" dot={false} />]; })}</LineChart></ResponsiveContainer></div>
        )}
      </Card>

      {!!data?.series?.length && <Card><h2 className="mb-3 text-lg font-semibold">模型对照</h2><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="border-b border-border text-left text-xs text-text-muted"><tr><th className="px-3 py-2">智能路由提供商</th><th className="px-3 py-2">路由模型</th><th className="px-3 py-2">主力模型</th><th className="px-3 py-2 text-right">请求数</th></tr></thead><tbody>{data.series.map((series) => <tr key={series.id} className="border-b border-border/60"><td className="px-3 py-2">{series.providerName}</td><td className="px-3 py-2 font-mono">{series.model}</td><td className="px-3 py-2 font-mono">{series.primaryModelName}</td><td className="px-3 py-2 text-right tabular-nums">{series.requests}</td></tr>)}</tbody></table></div></Card>}
    </div>
  );
}

SmartRoutingAnalysis.propTypes = {
  startDate: PropTypes.string.isRequired,
  endDate: PropTypes.string.isRequired,
  refreshToken: PropTypes.number,
};

function Metric({ title, value, hint }) { return <Card padding="sm"><p className="text-xs text-text-muted">{title}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>{hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}</Card>; }
function Empty({ text }) { return <div className="flex h-[420px] items-center justify-center text-sm text-text-muted">{text}</div>; }

Metric.propTypes = { title: PropTypes.string.isRequired, value: PropTypes.string.isRequired, hint: PropTypes.string };
Empty.propTypes = { text: PropTypes.string.isRequired };
