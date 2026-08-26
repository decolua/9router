"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, DropdownSelect, Input, Modal, SegmentedControl } from "@/shared/components";
import DashboardLayout from "@/shared/components/layouts/DashboardLayout";

const formatNumber = (value) => new Intl.NumberFormat("zh-CN").format(Number(value || 0));
const formatCost = (value) => `$${Number(value || 0).toFixed(6)}`;
const formatPercent = (value) => `${Number(value || 0).toFixed(2)}%`;
const isSuccessStatus = (status) => ["ok", "success", "200 ok"].includes(String(status || "").toLowerCase());
const renderRoutedValue = (value, routedValue, title) => <><div>{value || "-"}</div>{routedValue && <div className="mt-1"><span className="inline-flex rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-600" title={title}>实际 {routedValue}</span></div>}</>;
const MODEL_MARKET_LOG_COLUMNS = ["timestamp", "selectedModel", "actualModel", "provider", "endpoint", "input", "cacheRead", "cacheWrite", "cacheHitRate", "output", "total", "latency", "status"];
const EMPTY_FILTER_OPTIONS = { providers: [], endpoints: [], selectedModels: [], actualModels: [] };
const toLocalDateTimeValue = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export default function ModelMarketClient({ isDashboardView = false }) {
  const [apiKey, setApiKey] = useState("");
  const [activeKey, setActiveKey] = useState("");
  const activeKeyRef = useRef("");
  const [models, setModels] = useState([]);
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 0, totalItems: 0 });
  const [activeTab, setActiveTab] = useState("models");
  const [loading, setLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [error, setError] = useState("");
  const [logRange, setLogRange] = useState(() => { const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1); return { startDate: toLocalDateTimeValue(start), endDate: toLocalDateTimeValue(end) }; });
  const [logFilters, setLogFilters] = useState({ provider: null, endpoint: null, selectedModel: null, actualModel: null, logType: null });
  const [filterOptions, setFilterOptions] = useState(EMPTY_FILTER_OPTIONS);
  const [visibleLogColumns, setVisibleLogColumns] = useState(MODEL_MARKET_LOG_COLUMNS);
  const [dashboardKeys, setDashboardKeys] = useState(isDashboardView ? null : []);
  const [selectedLog, setSelectedLog] = useState(null);
  const [logDetail, setLogDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((settings) => {
      if (Array.isArray(settings?.modelMarketLogColumns) && settings.modelMarketLogColumns.length) setVisibleLogColumns(settings.modelMarketLogColumns);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isDashboardView) return;
    let cancelled = false;
    fetch("/api/keys", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("无法读取 API 密钥")))
      .then((data) => {
        if (cancelled) return;
        setDashboardKeys((data.keys || []).filter((key) => key.isActive !== false));
      })
      .catch((requestError) => {
        if (cancelled) return;
        setDashboardKeys([]);
        setError(requestError.message || "无法读取 API 密钥");
      });
    return () => { cancelled = true; };
  }, [isDashboardView]);

  const keysLoading = isDashboardView && dashboardKeys === null;
  const availableDashboardKeys = dashboardKeys || [];

  const groupedModels = useMemo(() => {
    const groups = new Map();
    for (const model of models) {
      const owner = model.owned_by || "其他";
      if (!groups.has(owner)) groups.set(owner, []);
      groups.get(owner).push(model);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [models]);

  const fetchLogs = useCallback(async (key, page = 1) => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20", startDate: logRange.startDate, endDate: logRange.endDate });
      Object.entries(logFilters).forEach(([name, value]) => {
        if (Array.isArray(value)) params.set(name, value.length ? value.join(",") : "__none__");
        else if (value) params.set(name, value);
      });
      const response = await fetch(`/api/model-market/logs?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${key}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法读取流量日志");
      setLogs(data.logs || []);
      setFilterOptions(data.filterOptions || EMPTY_FILTER_OPTIONS);
      if (Array.isArray(data.columns) && data.columns.length) setVisibleLogColumns(data.columns);
      setPagination(data.pagination || { page, totalPages: 0, totalItems: 0 });
    } finally {
      setLogsLoading(false);
    }
  }, [logFilters, logRange.endDate, logRange.startDate]);

  useEffect(() => {
    const key = activeKeyRef.current;
    if (!key) return undefined;
    const timeout = setTimeout(() => fetchLogs(key, 1).catch(() => {}), 0);
    return () => clearTimeout(timeout);
  }, [fetchLogs]);

  const handleSubmit = async (event, submittedKey) => {
    event.preventDefault();
    const key = (submittedKey ?? apiKey).trim();
    if (!key) return;
    setLoading(true);
    setError("");
    try {
      const modelResponse = await fetch("/v1/models", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${key}` },
      });
      const modelData = await modelResponse.json();
      if (!modelResponse.ok) throw new Error(modelData?.error?.message || "密钥无效或已停用");
      setModels(modelData.data || []);
      activeKeyRef.current = key;
      setActiveKey(key);
      await fetchLogs(key, 1);
    } catch (requestError) {
      activeKeyRef.current = "";
      setActiveKey("");
      setModels([]);
      setLogs([]);
      setFilterOptions(EMPTY_FILTER_OPTIONS);
      setPagination({ page: 1, totalPages: 0, totalItems: 0 });
      setError(requestError.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const changeLogPage = async (page) => {
    if (!activeKey || page < 1 || page > Math.max(1, pagination.totalPages)) return;
    setError("");
    try {
      await fetchLogs(activeKey, page);
    } catch (requestError) {
      setError(requestError.message || "日志加载失败");
    }
  };

  const refreshLogs = async () => {
    if (!activeKey) return;
    setError("");
    try {
      await fetchLogs(activeKey, pagination.page || 1);
    } catch (requestError) {
      setError(requestError.message || "日志加载失败");
    }
  };

  const updateLogFilter = (name, value) => setLogFilters((current) => ({ ...current, [name]: value }));

  const openLogDetail = async (log) => {
    if (isSuccessStatus(log.status)) return;
    setSelectedLog(log);
    setLogDetail(null);
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/model-market/logs/${log.id}/detail`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${activeKey}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法加载日志详情");
      setLogDetail(data.detail || null);
    } catch (requestError) {
      setError(requestError.message || "无法加载日志详情");
    } finally {
      setDetailLoading(false);
    }
  };

  const content = (
    <div className={isDashboardView ? "flex flex-col gap-6" : "mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8"}>
        {!isDashboardView && (
          <Link href="/model-market" className="flex w-fit items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary text-white"><span className="material-symbols-outlined text-[20px]">hub</span></span>
            <span><strong className="block text-sm">9Router 模型广场</strong><span className="block text-xs text-text-muted">按密钥查看可用能力</span></span>
          </Link>
        )}
        <section className="max-w-3xl">
          <p className="mb-2 text-xs font-semibold text-primary">MODEL ACCESS</p>
          <h1 className="text-3xl font-semibold sm:text-4xl">模型广场</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">{isDashboardView ? "选择管理平台中的 API 密钥，查看该密钥获准使用的模型及其自身产生的流量日志。" : "输入 9Router API 密钥，查看该密钥获准使用的模型及其自身产生的流量日志。密钥仅保留在当前页面内存中。"}</p>
        </section>

        <Card className="max-w-3xl">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {isDashboardView ? <DropdownSelect label="API 密钥" value={apiKey} onChange={setApiKey} options={availableDashboardKeys.map((key) => ({ value: key.key, label: `${key.name} (${key.key.slice(0, 8)}...)` }))} placeholder={keysLoading ? "正在加载密钥..." : "选择已有 API 密钥"} disabled={keysLoading || !availableDashboardKeys.length} searchable className="flex-1" /> : <Input label="API 密钥" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk_9router..." autoComplete="off" className="flex-1" />}
            <Button type="submit" icon="key" loading={loading} disabled={keysLoading || !apiKey.trim()} className="sm:w-32">查看</Button>
          </form>
          {isDashboardView && !keysLoading && !availableDashboardKeys.length && !error && <p className="mt-3 text-sm text-text-muted">暂无可用 API 密钥，请先在端点页面创建并启用密钥。</p>}
          {error && <p className="mt-3 flex items-center gap-2 text-sm text-red-500"><span className="material-symbols-outlined text-[18px]">error</span>{error}</p>}
        </Card>

        {activeKey && (
          <section className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SegmentedControl options={[{ value: "models", label: `可用模型 ${models.length}` }, { value: "logs", label: `流量日志 ${pagination.totalItems || 0}` }]} value={activeTab} onChange={setActiveTab} className="w-full sm:w-auto" />
            </div>

            {activeTab === "models" && (
              <div className="flex flex-col gap-6">
                {groupedModels.length ? groupedModels.map(([owner, ownerModels]) => (
                  <div key={owner}>
                    <div className="mb-3 flex items-center gap-2"><h2 className="text-sm font-semibold">{owner}</h2><span className="rounded bg-surface-2 px-2 py-0.5 text-[11px] text-text-muted">{ownerModels.length} 个模型</span></div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {ownerModels.map((model) => <Card key={model.id} className="group flex min-h-28 min-w-0 flex-col justify-between gap-4 border-border/80 p-4 transition-colors hover:border-primary/35 hover:bg-surface-2/40"><div className="flex min-w-0 items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><span className="material-symbols-outlined text-[19px]">smart_toy</span></span><p className="min-w-0 truncate font-mono text-sm font-semibold" title={model.id}>{model.id}</p></div>{model.description ? <p className="line-clamp-2 border-t border-border/60 pt-3 text-xs leading-5 text-text-muted" title={model.description}>{model.description}</p> : <p className="border-t border-border/60 pt-3 text-xs text-text-muted/70">暂无模型备注</p>}</Card>)}
                    </div>
                  </div>
                )) : <div className="border-y border-border py-16 text-center text-sm text-text-muted">该密钥当前没有可用模型</div>}
              </div>
            )}

            {activeTab === "logs" && (
              <>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2"><input type="datetime-local" value={logRange.startDate} onChange={(event) => setLogRange((current) => ({ ...current, startDate: event.target.value }))} className="h-9 rounded-md border border-border bg-surface px-2 text-xs" /><span className="text-xs text-text-muted">至</span><input type="datetime-local" value={logRange.endDate} onChange={(event) => setLogRange((current) => ({ ...current, endDate: event.target.value }))} className="h-9 rounded-md border border-border bg-surface px-2 text-xs" /></div>
                    <Button type="button" variant="outline" icon="refresh" loading={logsLoading} onClick={refreshLogs}>刷新</Button>
                  </div>
                  <div className="grid w-full grid-cols-1 items-end gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                    <DropdownSelect className="min-w-0 w-full" label="模型提供商" multiple value={logFilters.provider} onChange={(value) => updateLogFilter("provider", value)} searchable options={(filterOptions.providers || []).map((value) => ({ value, label: value }))} />
                    <DropdownSelect className="min-w-0 w-full" label="端点" multiple value={logFilters.endpoint} onChange={(value) => updateLogFilter("endpoint", value)} searchable options={(filterOptions.endpoints || []).map((value) => ({ value, label: value }))} />
                    <DropdownSelect className="min-w-0 w-full" label="用户选择" multiple value={logFilters.selectedModel} onChange={(value) => updateLogFilter("selectedModel", value)} searchable options={(filterOptions.selectedModels || []).map((value) => ({ value, label: value }))} />
                    <DropdownSelect className="min-w-0 w-full" label="实际请求模型" multiple value={logFilters.actualModel} onChange={(value) => updateLogFilter("actualModel", value)} searchable options={(filterOptions.actualModels || []).map((value) => ({ value, label: value }))} />
                    <DropdownSelect className="min-w-0 w-full" label="日志类型" multiple value={logFilters.logType} onChange={(value) => updateLogFilter("logType", value)} options={[{ value: "success", label: "成功" }, { value: "failed", label: "失败" }]} />
                  </div>
                </div>
                <Card className="overflow-hidden p-0">
                  <div className="overflow-x-auto">
                    {logsLoading ? <div className="p-12 text-center text-sm text-text-muted">正在加载流量日志...</div> : logs.length ? (
                      <table className="w-full min-w-[1180px] border-collapse text-xs">
                        <thead className="border-b border-border bg-bg-subtle text-text-muted"><tr>{visibleLogColumns.includes("timestamp") && <th className="px-3 py-2 text-left">时间</th>}{visibleLogColumns.includes("selectedModel") && <th className="px-3 py-2 text-left">用户选择</th>}{visibleLogColumns.includes("actualModel") && <th className="px-3 py-2 text-center">实际请求模型</th>}{visibleLogColumns.includes("provider") && <th className="px-3 py-2 text-center">提供商</th>}{visibleLogColumns.includes("endpoint") && <th className="px-3 py-2 text-left">端点</th>}{visibleLogColumns.includes("input") && <th className="px-3 py-2 text-right">输入</th>}{visibleLogColumns.includes("cacheRead") && <th className="px-3 py-2 text-right">缓存读取</th>}{visibleLogColumns.includes("cacheWrite") && <th className="px-3 py-2 text-right">缓存写入</th>}{visibleLogColumns.includes("cacheHitRate") && <th className="px-3 py-2 text-right">缓存命中率</th>}{visibleLogColumns.includes("output") && <th className="px-3 py-2 text-right">输出</th>}{visibleLogColumns.includes("total") && <th className="px-3 py-2 text-right">总和</th>}{visibleLogColumns.includes("latency") && <th className="px-3 py-2 text-right">延时</th>}{visibleLogColumns.includes("status") && <th className="px-3 py-2 text-left">状态</th>}<th className="px-3 py-2 text-center">详情</th></tr></thead>
                        <tbody className="divide-y divide-border/60">{logs.map((log) => { const failed = !isSuccessStatus(log.status); return <tr key={log.id} className={failed ? "border-l-2 border-red-500/60 bg-red-500/[0.05] hover:bg-red-500/[0.09]" : "hover:bg-bg-hover"}>{visibleLogColumns.includes("timestamp") && <td className="whitespace-nowrap px-3 py-2 text-text-muted">{new Date(log.timestamp).toLocaleString("zh-CN")}</td>}{visibleLogColumns.includes("selectedModel") && <td className="max-w-64 truncate px-3 py-2 font-mono" title={log.selectedModel}><span className="mr-1 rounded bg-primary/10 px-1 text-[10px] text-primary">{log.selectedModelType || "模型"}</span>{String(log.selectedModel || log.model || "-").replace(/^group:/, "")}</td>}{visibleLogColumns.includes("actualModel") && <td className="whitespace-nowrap px-3 py-2 text-center font-mono">{renderRoutedValue(log.actualModel || log.model, log.routerSelectedModel, "LLMRouter 最终调用模型")}</td>}{visibleLogColumns.includes("provider") && <td className="whitespace-nowrap px-3 py-2 text-center">{renderRoutedValue(log.provider, log.routerSelectedProvider, "LLMRouter 最终调用提供商")}</td>}{visibleLogColumns.includes("endpoint") && <td className="px-3 py-2">{log.endpoint || "-"}</td>}{visibleLogColumns.includes("input") && <td className="px-3 py-2 text-right tabular-nums"><div>{formatNumber(log.inputTokens)}</div><div className="text-[10px] text-text-muted">{formatCost(log.inputCost)}</div></td>}{visibleLogColumns.includes("cacheRead") && <td className="px-3 py-2 text-right tabular-nums"><div>{formatNumber(log.cacheReadTokens)}</div><div className="text-[10px] text-text-muted">{formatCost(log.cacheReadCost)}</div></td>}{visibleLogColumns.includes("cacheWrite") && <td className="px-3 py-2 text-right tabular-nums"><div>{formatNumber(log.cacheCreationTokens)}</div><div className="text-[10px] text-text-muted">{formatCost(log.cacheCreationCost)}</div></td>}{visibleLogColumns.includes("cacheHitRate") && <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums text-violet-500">{formatPercent(log.cacheHitRate)}</td>}{visibleLogColumns.includes("output") && <td className="px-3 py-2 text-right tabular-nums"><div>{formatNumber(log.outputTokens)}</div><div className="text-[10px] text-text-muted">{formatCost(log.outputCost)}</div></td>}{visibleLogColumns.includes("total") && <td className="px-3 py-2 text-right tabular-nums"><div>{formatNumber(Number(log.inputTokens || 0) + Number(log.cacheReadTokens || 0) + Number(log.cacheCreationTokens || 0) + Number(log.outputTokens || 0))}</div><div className="text-[10px] text-text-muted">{formatCost(log.cost)}</div></td>}{visibleLogColumns.includes("latency") && <td className="px-3 py-2 text-right tabular-nums">{log.latencyMs ? `${formatNumber(log.latencyMs)} ms` : "-"}</td>}{visibleLogColumns.includes("status") && <td className={`whitespace-nowrap px-3 py-2 font-semibold ${failed ? "text-error" : "text-success"}`}>{failed ? (log.status || "失败") : "成功"}</td>}<td className="px-3 py-2 text-center">{failed ? <button type="button" onClick={() => openLogDetail(log)} className="rounded p-1.5 text-error transition-colors hover:bg-error/10" title="查看错误详情" aria-label="查看错误详情"><span className="material-symbols-outlined text-[18px]">error</span></button> : <span className="text-text-muted/50" title="成功日志无详情">-</span>}</td></tr>; })}</tbody>
                      </table>
                    ) : <div className="p-12 text-center text-sm text-text-muted">该密钥暂无流量日志</div>}
                  </div>
                  <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-text-muted"><span>共 {pagination.totalItems || 0} 条</span><div className="flex items-center gap-2"><button type="button" disabled={!pagination.hasPrev || logsLoading} onClick={() => changeLogPage(pagination.page - 1)} className="rounded-md border border-border px-2 py-1 hover:bg-bg-hover disabled:opacity-40">上一页</button><span>{pagination.page || 1} / {pagination.totalPages || 1}</span><button type="button" disabled={!pagination.hasNext || logsLoading} onClick={() => changeLogPage(pagination.page + 1)} className="rounded-md border border-border px-2 py-1 hover:bg-bg-hover disabled:opacity-40">下一页</button></div></div>
                </Card>
                <Modal isOpen={!!selectedLog} onClose={() => { setSelectedLog(null); setLogDetail(null); }} title="流量错误详情" size="full" className="overflow-hidden" footer={<Button variant="secondary" onClick={() => { setSelectedLog(null); setLogDetail(null); }}>关闭</Button>}>
                  {detailLoading ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-muted"><span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>正在加载错误详情...</div> : <div className="flex flex-col gap-5"><div className="flex items-start gap-3 rounded-md border border-red-500/25 bg-red-500/[0.07] p-4"><span className="material-symbols-outlined mt-0.5 text-[22px] text-error">error</span><div className="min-w-0"><p className="font-semibold text-error">请求执行失败</p><p className="mt-1 break-words text-sm text-text-muted">{selectedLog?.status || "未知错误"}</p></div></div><div className="grid grid-cols-1 gap-x-6 gap-y-4 border-b border-border pb-5 sm:grid-cols-2 lg:grid-cols-3"><Detail label="发生时间" value={selectedLog?.timestamp ? new Date(selectedLog.timestamp).toLocaleString("zh-CN") : "-"} /><Detail label="提供商" value={selectedLog?.provider || "-"} /><Detail label="请求模型" value={selectedLog?.actualModel || selectedLog?.model || "-"} /><Detail label="路由最终模型" value={selectedLog?.routerSelectedModel || "-"} /><Detail label="路由最终提供商" value={selectedLog?.routerSelectedProvider || "-"} /><Detail label="日志 ID" value={selectedLog?.id || "-"} mono /></div>{!logDetail ? <div className="flex items-start gap-3 rounded-md border border-dashed border-border bg-bg-subtle p-4 text-sm text-text-muted"><span className="material-symbols-outlined text-[20px]">info</span><p>未找到对应的请求详情记录。请确认已启用请求详情记录。</p></div> : <div className="grid min-w-0 gap-4 lg:grid-cols-2"><DetailBlock title="上游回传信息" icon="cloud_download" value={logDetail.providerResponse || {}} /><DetailBlock title="请求结果" icon="data_object" value={logDetail.response || {}} /></div>}</div>}
                </Modal>
              </>
            )}
          </section>
        )}
    </div>
  );

  if (isDashboardView) {
    return <DashboardLayout>{content}</DashboardLayout>;
  }

  return (
    <main className="min-h-screen bg-bg text-text-main">
      {content}
    </main>
  );
}

function Detail({ label, value, mono = false }) { return <div className="min-w-0"><div className="text-xs text-text-muted">{label}</div><div className={`mt-1 break-words text-sm font-medium text-text-main ${mono ? "font-mono text-xs" : ""}`}>{value}</div></div>; }
function DetailBlock({ title, icon, value }) { return <section className="min-w-0 overflow-hidden rounded-md border border-border bg-bg-subtle"><div className="flex items-center gap-2 border-b border-border bg-surface px-4 py-3"><span className="material-symbols-outlined text-[18px] text-text-muted">{icon}</span><h3 className="text-sm font-semibold">{title}</h3></div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-text-main custom-scrollbar">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre></section>; }
