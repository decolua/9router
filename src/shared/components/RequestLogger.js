"use client";

import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import Card from "./Card";
import DropdownSelect from "./DropdownSelect";
import UsageDateRangeControl, { getPeriodRange } from "./UsageDateRangeControl";

const toLocalDateTimeValue = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
export const getDefaultLogFilters = (now = new Date()) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startDate: toLocalDateTimeValue(start), endDate: toLocalDateTimeValue(end), apiKey: "", provider: "", logType: "" };
};
const formatNumber = (value) => new Intl.NumberFormat("zh-CN").format(Number(value || 0));
const formatCost = (value) => `$${Number(value || 0).toFixed(6)}`;
const isSuccessStatus = (status) => ["ok", "success", "200 ok"].includes(String(status || "").toLowerCase());
const MetricCell = ({ tokens, cost, color }) => (
  <td className={`px-3 py-2 text-right tabular-nums ${color}`}>
    <div className="font-medium">{formatNumber(tokens)}</div>
    <div className="mt-0.5 text-[10px] text-text-muted">{formatCost(cost)}</div>
  </td>
);
MetricCell.propTypes = { tokens: PropTypes.number, cost: PropTypes.number, color: PropTypes.string };

export default function RequestLogger() {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, totalPages: 0 });
  const [filters, setFilters] = useState(() => getDefaultLogFilters());
  const [keys, setKeys] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [period, setPeriod] = useState("today");

  const fetchLogs = useCallback(async (showLoading = true, page = 1) => {
    if (showLoading) setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "50" });
      Object.entries(filters).forEach(([key, value]) => value && query.set(key, value));
      const response = await fetch(`/api/usage/request-logs?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      setLogs(data.logs || []);
      setPagination(data.pagination || { page, pageSize: 50, totalPages: 0 });
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetch("/api/keys", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => setKeys(data?.keys || [])).catch(() => {});
    fetch("/api/providers", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => setProviders([...new Set((data?.connections || []).map((connection) => connection.provider).filter(Boolean))].sort())).catch(() => {});
  }, []);
  useEffect(() => { fetchLogs(true, 1); }, [fetchLogs]);
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const interval = setInterval(() => fetchLogs(false, pagination.page), 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs, pagination.page]);

  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const resetFilters = () => {
    const range = getPeriodRange("today", new Date(), true);
    setPeriod("today");
    setFilters({ ...getDefaultLogFilters(), ...range });
  };

  return (
    <div className="flex flex-col gap-4" data-i18n-skip>
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 xl:flex-row xl:items-end">
          <UsageDateRangeControl className="xl:shrink-0" period={period} startDate={filters.startDate} endDate={filters.endDate} onPeriodChange={setPeriod} onStartDateChange={(value) => updateFilter("startDate", value)} onEndDateChange={(value) => updateFilter("endDate", value)} todayEndsTomorrow />
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
          <DropdownSelect label="API 密钥" value={filters.apiKey} onChange={(value) => updateFilter("apiKey", value)} searchable options={[{ value: "", label: "全部密钥" }, ...keys.map((key) => ({ value: key.id, label: key.name }))]} />
          <DropdownSelect label="模型提供商" value={filters.provider} onChange={(value) => updateFilter("provider", value)} searchable options={[{ value: "", label: "全部提供商" }, ...providers.map((provider) => ({ value: provider, label: provider }))]} />
          <DropdownSelect label="日志类型" value={filters.logType} onChange={(value) => updateFilter("logType", value)} options={[{ value: "", label: "全部类型" }, { value: "success", label: "成功" }, { value: "failed", label: "失败" }]} />
          </div>
        </div>
        <div className="flex h-9 shrink-0 flex-nowrap items-center gap-2 text-xs text-text-muted"><button onClick={resetFilters} className="h-9 min-w-16 whitespace-nowrap rounded-md border border-border px-3 hover:bg-bg-hover">重置</button><button onClick={() => setAutoRefresh((value) => !value)} className={`h-9 min-w-20 whitespace-nowrap rounded-md border px-3 ${autoRefresh ? "border-primary text-primary" : "border-border"}`}>{autoRefresh ? "自动刷新" : "已暂停"}</button></div>
      </div>

      <Card className="overflow-hidden">
        <div className="max-h-[680px] overflow-auto">
          {loading && !logs.length ? <div className="p-8 text-center text-text-muted">正在加载流量日志...</div> : !logs.length ? <div className="p-8 text-center text-text-muted">暂无流量日志</div> : (
            <table className="w-full min-w-[1220px] border-collapse text-xs">
              <thead className="sticky top-0 z-10 border-b border-border bg-bg-subtle text-text-muted"><tr><th className="px-3 py-2 text-left">时间</th><th className="px-3 py-2 text-left">API 密钥</th><th className="px-3 py-2 text-left">模型</th><th className="px-3 py-2 text-left">提供商</th><th className="px-3 py-2 text-left">端点</th><th className="px-3 py-2 text-right">输入</th><th className="px-3 py-2 text-right">缓存读取</th><th className="px-3 py-2 text-right">缓存写入</th><th className="px-3 py-2 text-right">输出</th><th className="px-3 py-2 text-left">状态</th></tr></thead>
              <tbody className="divide-y divide-border/60">{logs.map((log) => <tr key={log.id} className="hover:bg-bg-hover/60"><td className="whitespace-nowrap px-3 py-2 text-text-muted">{new Date(log.timestamp).toLocaleString("zh-CN")}</td><td className="px-3 py-2">{log.apiKeyName}</td><td className="px-3 py-2 font-mono">{log.model || "-"}</td><td className="px-3 py-2">{log.provider || "-"}</td><td className="px-3 py-2">{log.endpoint || "-"}</td><MetricCell tokens={log.inputTokens} cost={log.inputCost} color="text-primary" /><MetricCell tokens={log.cacheReadTokens} cost={log.cacheReadCost} color="text-sky-500" /><MetricCell tokens={log.cacheCreationTokens} cost={log.cacheCreationCost} color="text-cyan-500" /><MetricCell tokens={log.outputTokens} cost={log.outputCost} color="text-success" /><td className={`px-3 py-2 font-semibold ${isSuccessStatus(log.status) ? "text-success" : "text-error"}`}>{isSuccessStatus(log.status) ? "成功" : (log.status || "失败")}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-text-muted"><span>共 {pagination.totalItems || 0} 条</span><div className="flex items-center gap-2"><button disabled={!pagination.hasPrev} onClick={() => fetchLogs(true, pagination.page - 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">上一页</button><span>{pagination.page || 1} / {pagination.totalPages || 1}</span><button disabled={!pagination.hasNext} onClick={() => fetchLogs(true, pagination.page + 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">下一页</button></div></div>
      </Card>
    </div>
  );
}
