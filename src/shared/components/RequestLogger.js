"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import Card from "./Card";
import Button from "./Button";
import Modal from "./Modal";
import DropdownSelect from "./DropdownSelect";
import UsageDateRangeControl from "./UsageDateRangeControl";
import { getPeriodRange, normalizeUsagePeriod } from "@/shared/utils/usagePeriods";
import { useNotificationStore } from "@/store/notificationStore";

const toLocalDateTimeValue = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
export const getDefaultLogFilters = (now = new Date()) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startDate: toLocalDateTimeValue(start), endDate: toLocalDateTimeValue(end), apiKey: null, provider: null, endpoint: null, selectedModel: null, actualModel: null, logType: null };
};
const formatNumber = (value) => new Intl.NumberFormat("zh-CN").format(Number(value || 0));
const formatCost = (value) => `$${Number(value || 0).toFixed(6)}`;
const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;
const isSuccessStatus = (status) => ["ok", "success", "200 ok"].includes(String(status || "").toLowerCase());
const LOG_COLUMNS = [
  { id: "timestamp", label: "时间" },
  { id: "apiKey", label: "API 密钥" },
  { id: "selectedModel", label: "用户选择" },
  { id: "actualModel", label: "实际请求模型" },
  { id: "provider", label: "提供商" },
  { id: "endpoint", label: "端点" },
  { id: "input", label: "输入" },
  { id: "cacheRead", label: "缓存读取" },
  { id: "cacheWrite", label: "缓存写入" },
  { id: "cacheHitRate", label: "缓存命中率" },
  { id: "output", label: "输出" },
  { id: "total", label: "总和" },
  { id: "latency", label: "延时" },
  { id: "status", label: "状态" },
];
const DEFAULT_LOG_COLUMNS = new Set(LOG_COLUMNS.map((column) => column.id).filter((id) => id !== "endpoint"));
const LOG_COLUMNS_STORAGE_KEY = "9router:traffic-log-columns";
const LOG_COLUMNS_SCHEMA_KEY = "9router:traffic-log-columns-schema";
const LOG_COLUMNS_SCHEMA_VERSION = 2;
const LOG_SORT_STORAGE_KEY = "9router:traffic-log-sort";
const MetricCell = ({ tokens, cost, color }) => (
  <td className={`px-3 py-2 text-right tabular-nums ${color}`}>
    <div className="font-medium">{formatCost(cost)}</div>
    <div className="mt-0.5 text-[10px] text-text-muted">{formatNumber(tokens)} Token</div>
  </td>
);
MetricCell.propTypes = { tokens: PropTypes.number, cost: PropTypes.number, color: PropTypes.string };
const RateCell = ({ value, color = "text-violet-500" }) => (
  <td className={`whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums ${color}`}>
    {formatPercent(value)}
  </td>
);
RateCell.propTypes = { value: PropTypes.number, color: PropTypes.string };
const LatencyCell = ({ ttftMs, totalMs }) => (
  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-text-muted">
    <div>{ttftMs > 0 ? `${formatNumber(ttftMs)} ms` : "-"}</div>
    <div className="mt-0.5 text-[10px]">{totalMs > 0 ? `${formatNumber(totalMs)} ms` : "-"}</div>
  </td>
);
LatencyCell.propTypes = { ttftMs: PropTypes.number, totalMs: PropTypes.number };
const ActualModelCell = ({ log }) => (
  <td className="whitespace-nowrap px-3 py-2 text-center font-mono">
    <div>{log.smartRoutingModel || log.actualModel || log.model || "-"}</div>
    {log.routerSelectedModel && <div className="mt-1"><span className="inline-flex rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-600" title="智能路由最终调用模型">最终 {log.routerSelectedModel}</span></div>}
  </td>
);
ActualModelCell.propTypes = { log: PropTypes.object.isRequired };
const ProviderCell = ({ log }) => (
  <td className="whitespace-nowrap px-3 py-2 text-center">
    <div>{log.provider || "-"}</div>
    {log.routerSelectedProvider && <div className="mt-1"><span className="inline-flex rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-600" title="智能路由最终调用提供商">最终 {log.routerSelectedProvider}</span></div>}
  </td>
);
ProviderCell.propTypes = { log: PropTypes.object.isRequired };
const SortHeader = ({ id, children, align = "left", sortState, onSort }) => <button type="button" onClick={() => onSort(id)} className={`inline-flex items-center gap-1 whitespace-nowrap ${align === "right" ? "text-right" : align === "center" ? "w-full justify-center text-center" : "text-left"}`}><span>{children}</span><span className="material-symbols-outlined text-[14px]">{sortState.field === id ? (sortState.direction === "asc" ? "arrow_upward" : "arrow_downward") : "unfold_more"}</span></button>;
SortHeader.propTypes = { id: PropTypes.string.isRequired, children: PropTypes.node.isRequired, align: PropTypes.string, sortState: PropTypes.object.isRequired, onSort: PropTypes.func.isRequired };

export default function RequestLogger() {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, totalPages: 0 });
  const [filters, setFilters] = useState(() => getDefaultLogFilters());
  const [keys, setKeys] = useState([]);
  const [providers, setProviders] = useState([]);
  const [filterOptions, setFilterOptions] = useState({ providers: [], endpoints: [], selectedModels: [], actualModels: [] });
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("today");
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(DEFAULT_LOG_COLUMNS));
  const [sortState, setSortState] = useState(() => ({ field: "timestamp", direction: "desc" }));
  const [defaultPeriod, setDefaultPeriod] = useState("today");
  const [selectedLog, setSelectedLog] = useState(null);
  const [logDetail, setLogDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const notify = useNotificationStore();

  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        const columns = JSON.parse(localStorage.getItem(LOG_COLUMNS_STORAGE_KEY) || "null");
        if (Array.isArray(columns) && columns.length) {
          const nextColumns = new Set(columns);
          const schemaVersion = Number(localStorage.getItem(LOG_COLUMNS_SCHEMA_KEY) || 0);
          if (schemaVersion < LOG_COLUMNS_SCHEMA_VERSION) nextColumns.add("cacheHitRate");
          setVisibleColumns(nextColumns);
          localStorage.setItem(LOG_COLUMNS_STORAGE_KEY, JSON.stringify([...nextColumns]));
        }
        localStorage.setItem(LOG_COLUMNS_SCHEMA_KEY, String(LOG_COLUMNS_SCHEMA_VERSION));
        const sort = JSON.parse(localStorage.getItem(LOG_SORT_STORAGE_KEY) || "null");
        if (sort?.field) setSortState({ field: sort.field, direction: sort.direction === "asc" ? "asc" : "desc" });
      } catch {}
    }, 0);
    return () => clearTimeout(timeout);
  }, []);

  const fetchLogs = useCallback(async (showLoading = true, page = 1) => {
    if (showLoading) setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "50", sortBy: sortState.field, sortOrder: sortState.direction });
      Object.entries(filters).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          query.set(key, value.length ? value.join(",") : "__none__");
        } else if (value) query.set(key, value);
      });
      const response = await fetch(`/api/usage/request-logs?${query.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("无法加载流量日志");
      const data = await response.json();
      setLogs(data.logs || []);
      setFilterOptions(data.filterOptions || { providers: [], endpoints: [], selectedModels: [], actualModels: [] });
      setPagination(data.pagination || { page, pageSize: 50, totalPages: 0 });
    } catch (error) {
      console.error("Failed to fetch logs:", error);
      if (showLoading) notify.error(error.message || "无法加载流量日志");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [filters, notify, sortState]);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((settings) => {
        if (!settings) return;
        const nextPeriod = normalizeUsagePeriod(settings.trafficLogsDefaultPeriod);
        const range = getPeriodRange(nextPeriod, new Date(), true);
        setDefaultPeriod(nextPeriod);
        setPeriod(nextPeriod);
        setFilters((current) => ({ ...current, ...range }));
      })
      .catch(() => {});
    fetch("/api/keys", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => setKeys((data?.keys || []).filter((key) => !key.smartRoutingProviders?.length))).catch(() => {});
    fetch("/api/providers", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => {
      const unique = new Map();
      for (const connection of data?.connections || []) {
        if (connection.provider) unique.set(connection.provider, connection.providerName || connection.provider);
      }
      setProviders([...unique.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)));
    }).catch(() => {});
  }, []);
  useEffect(() => {
    const timeout = setTimeout(() => fetchLogs(true, 1), 0);
    return () => clearTimeout(timeout);
  }, [fetchLogs]);
  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }));
  const resetFilters = () => {
    const range = getPeriodRange(defaultPeriod, new Date(), true);
    setPeriod(defaultPeriod);
    setFilters({ ...getDefaultLogFilters(), ...range });
  };
  const isColumnVisible = (columnId) => visibleColumns.has(columnId);
  const toggleColumn = (columnId) => setVisibleColumns((current) => {
    const next = new Set(current);
    next.has(columnId) ? next.delete(columnId) : next.add(columnId);
    if (next.size) {
      try { localStorage.setItem(LOG_COLUMNS_STORAGE_KEY, JSON.stringify([...next])); } catch {}
      return next;
    }
    return current;
  });
  const toggleSort = (field) => setSortState((current) => {
    const next = { field, direction: current.field === field && current.direction === "asc" ? "desc" : "asc" };
    try { localStorage.setItem(LOG_SORT_STORAGE_KEY, JSON.stringify(next)); } catch {}
    return next;
  });
  const openDetail = async (log) => {
    if (isSuccessStatus(log.status)) return;
    setSelectedLog(log);
    setLogDetail(null);
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/usage/logs/${log.id}/detail`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法加载日志详情");
      setLogDetail(data.detail || null);
    } catch (error) {
      notify.error(error.message || "无法加载日志详情");
    } finally {
      setDetailLoading(false);
    }
  };
  const sortedLogs = logs;
  const providerOptions = useMemo(() => {
    const options = new Map(providers.map((item) => [item.value, item.label]));
    for (const provider of filterOptions.providers || []) if (!options.has(provider)) options.set(provider, provider);
    return [...options.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [filterOptions.providers, providers]);
  const totals = useMemo(() => logs.reduce((sum, log) => ({
    input: sum.input + Number(log.inputTokens || 0),
    inputCost: sum.inputCost + Number(log.inputCost || 0),
    cacheRead: sum.cacheRead + Number(log.cacheReadTokens || 0),
    cacheReadCost: sum.cacheReadCost + Number(log.cacheReadCost || 0),
    cacheWrite: sum.cacheWrite + Number(log.cacheCreationTokens || 0),
    cacheWriteCost: sum.cacheWriteCost + Number(log.cacheCreationCost || 0),
    output: sum.output + Number(log.outputTokens || 0),
    outputCost: sum.outputCost + Number(log.outputCost || 0),
    cost: sum.cost + Number(log.cost || 0),
  }), { input: 0, inputCost: 0, cacheRead: 0, cacheReadCost: 0, cacheWrite: 0, cacheWriteCost: 0, output: 0, outputCost: 0, cost: 0 }), [logs]);
  const leadingColumnCount = ["timestamp", "apiKey", "selectedModel", "actualModel", "provider", "endpoint"].filter(isColumnVisible).length;
  const totalInputTokens = totals.input + totals.cacheRead + totals.cacheWrite;
  const totalCacheHitRate = totalInputTokens > 0 ? totals.cacheRead / totalInputTokens * 100 : 0;

  return (
    <div className="flex flex-col gap-4" data-i18n-skip>
      <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <UsageDateRangeControl className="min-w-0" period={period} startDate={filters.startDate} endDate={filters.endDate} onPeriodChange={setPeriod} onStartDateChange={(value) => updateFilter("startDate", value)} onEndDateChange={(value) => updateFilter("endDate", value)} todayEndsTomorrow />
            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 text-xs text-text-muted"><button onClick={() => setShowColumnSettings(true)} className="flex h-9 min-w-20 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-border bg-surface px-3 hover:bg-bg-hover"><span className="material-symbols-outlined text-[17px]">view_column</span>列设置</button><button onClick={resetFilters} className="flex h-9 min-w-16 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-border bg-surface px-3 hover:bg-bg-hover"><span className="material-symbols-outlined text-[17px]">restart_alt</span>重置</button><button onClick={() => fetchLogs(true, pagination.page)} disabled={loading} className="flex h-9 min-w-20 items-center justify-center gap-1 whitespace-nowrap rounded-md border border-border bg-surface px-3 hover:bg-bg-hover disabled:opacity-50"><span className={`material-symbols-outlined text-[17px] ${loading ? "animate-spin" : ""}`}>refresh</span>刷新</button></div>
          </div>
          <div className="grid w-full grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <DropdownSelect className="min-w-0 w-full" label="API 密钥" multiple value={filters.apiKey} onChange={(value) => updateFilter("apiKey", value)} searchable options={keys.map((key) => ({ value: key.id, label: key.name }))} />
            <DropdownSelect className="min-w-0 w-full" label="模型提供商" multiple value={filters.provider} onChange={(value) => updateFilter("provider", value)} searchable options={providerOptions} />
            <DropdownSelect className="min-w-0 w-full" label="端点" multiple value={filters.endpoint} onChange={(value) => updateFilter("endpoint", value)} searchable options={filterOptions.endpoints.map((value) => ({ value, label: value }))} />
            <DropdownSelect className="min-w-0 w-full" label="用户选择" multiple value={filters.selectedModel} onChange={(value) => updateFilter("selectedModel", value)} searchable options={filterOptions.selectedModels.map((value) => ({ value, label: value }))} />
            <DropdownSelect className="min-w-0 w-full" label="实际请求模型" multiple value={filters.actualModel} onChange={(value) => updateFilter("actualModel", value)} searchable options={filterOptions.actualModels.map((value) => ({ value, label: value }))} />
            <DropdownSelect className="min-w-0 w-full" label="日志类型" multiple value={filters.logType} onChange={(value) => updateFilter("logType", value)} options={[{ value: "success", label: "成功" }, { value: "failed", label: "失败" }]} />
          </div>
      </div>

      <Card className="overflow-hidden">
        <div className="max-h-[680px] overflow-auto">
          {loading && !logs.length ? <div className="p-8 text-center text-text-muted">正在加载流量日志...</div> : !logs.length ? <div className="p-8 text-center text-text-muted">暂无流量日志</div> : (
           <table className="w-full min-w-[1440px] border-collapse text-xs">
               <thead className="sticky top-0 z-10 border-b border-border bg-surface text-text-muted"><tr>{isColumnVisible("timestamp") && <th className="whitespace-nowrap px-3 py-2 text-left"><SortHeader id="timestamp" sortState={sortState} onSort={toggleSort}>时间</SortHeader></th>}{isColumnVisible("apiKey") && <th className="whitespace-nowrap px-3 py-2 text-left"><SortHeader id="apiKeyName" sortState={sortState} onSort={toggleSort}>API 密钥</SortHeader></th>}{isColumnVisible("selectedModel") && <th className="whitespace-nowrap px-3 py-2 text-left"><SortHeader id="selectedModel" sortState={sortState} onSort={toggleSort}>用户选择</SortHeader></th>}{isColumnVisible("actualModel") && <th className="whitespace-nowrap px-3 py-2 text-center"><SortHeader id="actualModel" align="center" sortState={sortState} onSort={toggleSort}>实际请求模型</SortHeader></th>}{isColumnVisible("provider") && <th className="whitespace-nowrap px-3 py-2 text-center"><SortHeader id="provider" align="center" sortState={sortState} onSort={toggleSort}>提供商</SortHeader></th>}{isColumnVisible("endpoint") && <th className="whitespace-nowrap px-3 py-2 text-left"><SortHeader id="endpoint" sortState={sortState} onSort={toggleSort}>端点</SortHeader></th>}{isColumnVisible("input") && <th className="whitespace-nowrap px-3 py-2 text-right"><SortHeader id="inputTokens" align="right" sortState={sortState} onSort={toggleSort}>输入</SortHeader></th>}{isColumnVisible("cacheRead") && <th className="whitespace-nowrap px-3 py-2 text-right"><SortHeader id="cacheReadTokens" align="right" sortState={sortState} onSort={toggleSort}>缓存读取</SortHeader></th>}{isColumnVisible("cacheWrite") && <th className="whitespace-nowrap px-3 py-2 text-right"><SortHeader id="cacheCreationTokens" align="right" sortState={sortState} onSort={toggleSort}>缓存写入</SortHeader></th>}{isColumnVisible("cacheHitRate") && <th className="whitespace-nowrap px-3 py-2 text-right"><SortHeader id="cacheHitRate" align="right" sortState={sortState} onSort={toggleSort}>缓存命中率</SortHeader></th>}{isColumnVisible("output") && <th className="whitespace-nowrap px-3 py-2 text-right"><SortHeader id="outputTokens" align="right" sortState={sortState} onSort={toggleSort}>输出</SortHeader></th>}{isColumnVisible("total") && <th className="whitespace-nowrap px-3 py-2 text-right"><SortHeader id="totalTokens" align="right" sortState={sortState} onSort={toggleSort}>总和</SortHeader></th>}{isColumnVisible("latency") && <th className="whitespace-nowrap px-3 py-2 text-right"><SortHeader id="latencyMs" align="right" sortState={sortState} onSort={toggleSort}>首 Token / 完成</SortHeader></th>}{isColumnVisible("status") && <th className="whitespace-nowrap px-3 py-2 text-left"><SortHeader id="status" sortState={sortState} onSort={toggleSort}>状态</SortHeader></th>}<th className="whitespace-nowrap px-3 py-2 text-center">详情</th></tr></thead>
               <tbody className="divide-y divide-border/60">{sortedLogs.map((log) => { const failed = !isSuccessStatus(log.status); return <tr key={log.id} className={failed ? "border-l-2 border-red-500/60 bg-red-500/[0.05] hover:bg-red-500/[0.09]" : "hover:bg-bg-hover/60"}>{isColumnVisible("timestamp") && <td className="whitespace-nowrap px-3 py-2 text-text-muted">{new Date(log.timestamp).toLocaleString("zh-CN")}</td>}{isColumnVisible("apiKey") && <td className="whitespace-nowrap px-3 py-2">{log.apiKeyName}</td>}{isColumnVisible("selectedModel") && <td className="px-3 py-2 font-mono"><span className="mr-1 rounded bg-primary/10 px-1 text-[10px] text-primary">{log.selectedModelType || "模型"}</span>{String(log.selectedModel || log.model || "-").replace(/^group:/, "")}</td>}{isColumnVisible("actualModel") && <ActualModelCell log={log} />}{isColumnVisible("provider") && <ProviderCell log={log} />}{isColumnVisible("endpoint") && <td className="px-3 py-2">{log.endpoint || "-"}</td>}{isColumnVisible("input") && <MetricCell tokens={log.inputTokens} cost={log.inputCost} color="text-primary" />}{isColumnVisible("cacheRead") && <MetricCell tokens={log.cacheReadTokens} cost={log.cacheReadCost} color="text-sky-500" />}{isColumnVisible("cacheWrite") && <MetricCell tokens={log.cacheCreationTokens} cost={log.cacheCreationCost} color="text-cyan-500" />}{isColumnVisible("cacheHitRate") && <RateCell value={log.cacheHitRate} />}{isColumnVisible("output") && <MetricCell tokens={log.outputTokens} cost={log.outputCost} color="text-success" />}{isColumnVisible("total") && <MetricCell tokens={Number(log.inputTokens || 0) + Number(log.cacheReadTokens || 0) + Number(log.cacheCreationTokens || 0) + Number(log.outputTokens || 0)} cost={log.cost} color="text-warning" />}{isColumnVisible("latency") && <LatencyCell ttftMs={log.ttftMs} totalMs={log.latencyMs} />}{isColumnVisible("status") && <td className={`whitespace-nowrap px-3 py-2 font-semibold ${failed ? "text-error" : "text-success"}`}>{failed ? (log.status || "失败") : "成功"}</td>}<td className="px-3 py-2 text-center">{failed ? <button type="button" onClick={() => openDetail(log)} className="rounded p-1.5 text-error transition-colors hover:bg-error/10" title="查看错误详情" aria-label="查看错误详情"><span className="material-symbols-outlined text-[18px]">error</span></button> : <span className="text-text-muted/50" title="成功日志无详情">-</span>}</td></tr>; })}</tbody>
               <tfoot className="sticky bottom-0 z-20"><tr className="border-t-2 border-border bg-white font-semibold shadow-[0_-2px_8px_rgba(0,0,0,0.08)] [&>td]:bg-white"><td colSpan={Math.max(1, leadingColumnCount)} className="px-3 py-2 text-right">当前页合计</td>{isColumnVisible("input") && <MetricCell tokens={totals.input} cost={totals.inputCost} color="text-primary" />}{isColumnVisible("cacheRead") && <MetricCell tokens={totals.cacheRead} cost={totals.cacheReadCost} color="text-sky-500" />}{isColumnVisible("cacheWrite") && <MetricCell tokens={totals.cacheWrite} cost={totals.cacheWriteCost} color="text-cyan-500" />}{isColumnVisible("cacheHitRate") && <RateCell value={totalCacheHitRate} />}{isColumnVisible("output") && <MetricCell tokens={totals.output} cost={totals.outputCost} color="text-success" />}{isColumnVisible("total") && <MetricCell tokens={totals.input + totals.cacheRead + totals.cacheWrite + totals.output} cost={totals.cost} color="text-warning" />}{isColumnVisible("latency") && <td />}{isColumnVisible("status") && <td />}<td /></tr></tfoot>
            </table>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-text-muted"><span>共 {pagination.totalItems || 0} 条</span><div className="flex items-center gap-2"><button disabled={!pagination.hasPrev} onClick={() => fetchLogs(true, pagination.page - 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">上一页</button><span>{pagination.page || 1} / {pagination.totalPages || 1}</span><button disabled={!pagination.hasNext} onClick={() => fetchLogs(true, pagination.page + 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">下一页</button></div></div>
      </Card>
      <Modal isOpen={showColumnSettings} onClose={() => setShowColumnSettings(false)} title="日志列设置" footer={<Button onClick={() => setShowColumnSettings(false)}>完成</Button>}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {LOG_COLUMNS.map((column) => <label key={column.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm"><input type="checkbox" checked={visibleColumns.has(column.id)} onChange={() => toggleColumn(column.id)} /><span className="whitespace-nowrap">{column.label}</span></label>)}
        </div>
      </Modal>
      <Modal isOpen={!!selectedLog} onClose={() => { setSelectedLog(null); setLogDetail(null); }} title="流量错误详情" size="full" className="overflow-hidden" footer={<Button variant="secondary" onClick={() => { setSelectedLog(null); setLogDetail(null); }}>关闭</Button>}>
        {detailLoading ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-muted"><span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>正在加载错误详情...</div> : <div className="flex flex-col gap-5"><div className="flex items-start gap-3 rounded-md border border-red-500/25 bg-red-500/[0.07] p-4"><span className="material-symbols-outlined mt-0.5 text-[22px] text-error">error</span><div className="min-w-0"><p className="font-semibold text-error">请求执行失败</p><p className="mt-1 break-words text-sm text-text-muted">{selectedLog?.status || "未知错误"}</p></div></div><div className="grid grid-cols-1 gap-x-6 gap-y-4 border-b border-border pb-5 sm:grid-cols-2 lg:grid-cols-3"><Detail label="发生时间" value={selectedLog?.timestamp ? new Date(selectedLog.timestamp).toLocaleString("zh-CN") : "-"} /><Detail label="提供商" value={selectedLog?.provider || "-"} /><Detail label="请求模型" value={selectedLog?.actualModel || selectedLog?.model || "-"} /><Detail label="路由最终模型" value={selectedLog?.routerSelectedModel || "-"} /><Detail label="路由最终提供商" value={selectedLog?.routerSelectedProvider || "-"} /><Detail label="日志 ID" value={selectedLog?.id || "-"} mono /></div>{!logDetail ? <div className="flex items-start gap-3 rounded-md border border-dashed border-border bg-bg-subtle p-4 text-sm text-text-muted"><span className="material-symbols-outlined text-[20px]">info</span><p>未找到对应的请求详情记录。请确认已启用请求详情记录。</p></div> : <div className="grid min-w-0 gap-4 lg:grid-cols-2"><DetailBlock title="上游回传信息" icon="cloud_download" value={logDetail.providerResponse || logDetail.response || {}} /><DetailBlock title="请求结果" icon="data_object" value={logDetail.response || {}} /></div>}</div>}
      </Modal>
    </div>
  );
}

function Detail({ label, value, mono = false }) { return <div className="min-w-0"><div className="text-xs text-text-muted">{label}</div><div className={`mt-1 break-words text-sm font-medium text-text-main ${mono ? "font-mono text-xs" : ""}`}>{value}</div></div>; }
function DetailBlock({ title, icon, value }) { return <section className="min-w-0 overflow-hidden rounded-md border border-border bg-bg-subtle"><div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-3"><span className="material-symbols-outlined text-[18px] text-text-muted">{icon}</span><h3 className="text-sm font-semibold">{title}</h3></div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-text-main custom-scrollbar">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre></section>; }
