"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, Input, SegmentedControl } from "@/shared/components";
import DashboardLayout from "@/shared/components/layouts/DashboardLayout";

const formatNumber = (value) => new Intl.NumberFormat("zh-CN").format(Number(value || 0));
const formatCost = (value) => `$${Number(value || 0).toFixed(6)}`;
const renderRoutedValue = (value, routedValue, title) => <><div>{value || "-"}</div>{routedValue && <div className="mt-1"><span className="inline-flex rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-600" title={title}>实际 {routedValue}</span></div>}</>;
const MODEL_MARKET_LOG_COLUMNS = ["timestamp", "selectedModel", "actualModel", "provider", "endpoint", "input", "cacheRead", "cacheWrite", "output", "total", "latency", "status"];
const MODEL_MARKET_KEY_STORAGE = "9router:model-market:api-key";
const toLocalDateTimeValue = (date) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export default function ModelMarketClient({ isDashboardView = false }) {
  const [apiKey, setApiKey] = useState("");
  const [activeKey, setActiveKey] = useState("");
  const [models, setModels] = useState([]);
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 0, totalItems: 0 });
  const [activeTab, setActiveTab] = useState("models");
  const [loading, setLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [error, setError] = useState("");
  const [logRange, setLogRange] = useState(() => { const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 1); return { startDate: toLocalDateTimeValue(start), endDate: toLocalDateTimeValue(end) }; });
  const [visibleLogColumns, setVisibleLogColumns] = useState(MODEL_MARKET_LOG_COLUMNS);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((settings) => {
      if (Array.isArray(settings?.modelMarketLogColumns) && settings.modelMarketLogColumns.length) setVisibleLogColumns(settings.modelMarketLogColumns);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (isDashboardView || typeof window === "undefined") return;
    const cached = window.localStorage.getItem(MODEL_MARKET_KEY_STORAGE);
    if (cached) {
      setApiKey(cached);
      // Apply the cached key automatically when returning to the public page.
      handleSubmit({ preventDefault() {} }, cached);
    }
  }, [isDashboardView]);

  const groupedModels = useMemo(() => {
    const groups = new Map();
    for (const model of models) {
      const owner = model.owned_by || "其他";
      if (!groups.has(owner)) groups.set(owner, []);
      groups.get(owner).push(model);
    }
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [models]);

  const fetchLogs = async (key, page = 1) => {
    setLogsLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20", startDate: logRange.startDate, endDate: logRange.endDate });
      const response = await fetch(`/api/model-market/logs?${params.toString()}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${key}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "无法读取流量日志");
      setLogs(data.logs || []);
      if (Array.isArray(data.columns) && data.columns.length) setVisibleLogColumns(data.columns);
      setPagination(data.pagination || { page, totalPages: 0, totalItems: 0 });
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => { if (activeKey) fetchLogs(activeKey, 1).catch(() => {}); }, [logRange.startDate, logRange.endDate]);

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
      setActiveKey(key);
      if (!isDashboardView && typeof window !== "undefined") window.localStorage.setItem(MODEL_MARKET_KEY_STORAGE, key);
      await fetchLogs(key, 1);
    } catch (requestError) {
      setActiveKey("");
      setModels([]);
      setLogs([]);
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
          <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">输入 9Router API 密钥，查看该密钥获准使用的模型及其自身产生的流量日志。密钥仅保留在当前页面内存中。</p>
        </section>

        <Card className="max-w-3xl">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Input label="API 密钥" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk_9router..." autoComplete="off" className="flex-1" />
            <Button type="submit" icon="key" loading={loading} disabled={!apiKey.trim()} className="sm:w-32">查看</Button>
          </form>
          {error && <p className="mt-3 flex items-center gap-2 text-sm text-red-500"><span className="material-symbols-outlined text-[18px]">error</span>{error}</p>}
        </Card>

        {activeKey && (
          <section className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SegmentedControl options={[{ value: "models", label: `可用模型 ${models.length}` }, { value: "logs", label: `流量日志 ${pagination.totalItems || 0}` }]} value={activeTab} onChange={setActiveTab} className="w-full sm:w-auto" />
              <div className="flex flex-wrap items-center gap-2"><input type="datetime-local" value={logRange.startDate} onChange={(event) => setLogRange((current) => ({ ...current, startDate: event.target.value }))} className="h-9 rounded-md border border-border bg-surface px-2 text-xs" /><span className="text-xs text-text-muted">至</span><input type="datetime-local" value={logRange.endDate} onChange={(event) => setLogRange((current) => ({ ...current, endDate: event.target.value }))} className="h-9 rounded-md border border-border bg-surface px-2 text-xs" /></div>
            </div>

            {activeTab === "models" && (
              <div className="flex flex-col gap-6">
                {groupedModels.length ? groupedModels.map(([owner, ownerModels]) => (
                  <div key={owner}>
                    <div className="mb-2 flex items-center gap-2"><h2 className="text-sm font-semibold">{owner}</h2><span className="text-xs text-text-muted">{ownerModels.length} 个模型</span></div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {ownerModels.map((model) => <Card key={model.id} className="flex min-w-0 items-start gap-3 p-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><span className="material-symbols-outlined text-[19px]">smart_toy</span></span><div className="min-w-0"><p className="truncate font-mono text-sm" title={model.id}>{model.id}</p>{model.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-text-muted" title={model.description}>{model.description}</p>}</div></Card>)}
                    </div>
                  </div>
                )) : <div className="border-y border-border py-16 text-center text-sm text-text-muted">该密钥当前没有可用模型</div>}
              </div>
            )}

            {activeTab === "logs" && (
              <Card className="overflow-hidden p-0">
                <div className="overflow-x-auto">
                  {logsLoading ? <div className="p-12 text-center text-sm text-text-muted">正在加载流量日志...</div> : logs.length ? (
                    <table className="w-full min-w-[900px] border-collapse text-xs">
                      <thead className="border-b border-border bg-bg-subtle text-text-muted"><tr>{visibleLogColumns.includes("timestamp") && <th className="px-3 py-2 text-left">时间</th>}{visibleLogColumns.includes("selectedModel") && <th className="px-3 py-2 text-left">用户选择模型</th>}{visibleLogColumns.includes("actualModel") && <th className="px-3 py-2 text-center">实际请求模型</th>}{visibleLogColumns.includes("provider") && <th className="px-3 py-2 text-center">提供商</th>}{visibleLogColumns.includes("endpoint") && <th className="px-3 py-2 text-left">端点</th>}{visibleLogColumns.includes("input") && <th className="px-3 py-2 text-right">输入</th>}{visibleLogColumns.includes("cacheRead") && <th className="px-3 py-2 text-right">缓存读取</th>}{visibleLogColumns.includes("cacheWrite") && <th className="px-3 py-2 text-right">缓存写入</th>}{visibleLogColumns.includes("output") && <th className="px-3 py-2 text-right">输出</th>}{visibleLogColumns.includes("total") && <th className="px-3 py-2 text-right">总和</th>}{visibleLogColumns.includes("latency") && <th className="px-3 py-2 text-right">延时</th>}{visibleLogColumns.includes("status") && <th className="px-3 py-2 text-left">状态</th>}</tr></thead>
                      <tbody className="divide-y divide-border/60">{logs.map((log) => <tr key={log.id} className="hover:bg-bg-hover">{visibleLogColumns.includes("timestamp") && <td className="whitespace-nowrap px-3 py-2 text-text-muted">{new Date(log.timestamp).toLocaleString("zh-CN")}</td>}{visibleLogColumns.includes("selectedModel") && <td className="max-w-64 truncate px-3 py-2 font-mono" title={log.selectedModel}><span className="mr-1 rounded bg-primary/10 px-1 text-[10px] text-primary">{log.selectedModelType || "模型"}</span>{log.selectedModel || log.model || "-"}</td>}{visibleLogColumns.includes("actualModel") && <td className="whitespace-nowrap px-3 py-2 text-center font-mono">{renderRoutedValue(log.actualModel || log.model, log.routerSelectedModel, "LLMRouter 最终调用模型")}</td>}{visibleLogColumns.includes("provider") && <td className="whitespace-nowrap px-3 py-2 text-center">{renderRoutedValue(log.provider, log.routerSelectedProvider, "LLMRouter 最终调用提供商")}</td>}{visibleLogColumns.includes("endpoint") && <td className="px-3 py-2">{log.endpoint || "-"}</td>}{visibleLogColumns.includes("input") && <td className="px-3 py-2 text-right tabular-nums"><div>{formatNumber(log.inputTokens)}</div><div className="text-[10px] text-text-muted">{formatCost(log.inputCost)}</div></td>}{visibleLogColumns.includes("cacheRead") && <td className="px-3 py-2 text-right tabular-nums"><div>{formatNumber(log.cacheReadTokens)}</div><div className="text-[10px] text-text-muted">{formatCost(log.cacheReadCost)}</div></td>}{visibleLogColumns.includes("cacheWrite") && <td className="px-3 py-2 text-right tabular-nums"><div>{formatNumber(log.cacheCreationTokens)}</div><div className="text-[10px] text-text-muted">{formatCost(log.cacheCreationCost)}</div></td>}{visibleLogColumns.includes("output") && <td className="px-3 py-2 text-right tabular-nums"><div>{formatNumber(log.outputTokens)}</div><div className="text-[10px] text-text-muted">{formatCost(log.outputCost)}</div></td>}{visibleLogColumns.includes("total") && <td className="px-3 py-2 text-right tabular-nums"><div>{formatNumber(Number(log.inputTokens || 0) + Number(log.cacheReadTokens || 0) + Number(log.cacheCreationTokens || 0) + Number(log.outputTokens || 0))}</div><div className="text-[10px] text-text-muted">{formatCost(log.cost)}</div></td>}{visibleLogColumns.includes("latency") && <td className="px-3 py-2 text-right tabular-nums">{log.latencyMs ? `${formatNumber(log.latencyMs)} ms` : "-"}</td>}{visibleLogColumns.includes("status") && <td className="px-3 py-2">{log.status || "-"}</td>}</tr>)}</tbody>
                    </table>
                  ) : <div className="p-12 text-center text-sm text-text-muted">该密钥暂无流量日志</div>}
                </div>
                <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-text-muted"><span>共 {pagination.totalItems || 0} 条</span><div className="flex items-center gap-2"><button type="button" disabled={!pagination.hasPrev || logsLoading} onClick={() => changeLogPage(pagination.page - 1)} className="rounded-md border border-border px-2 py-1 hover:bg-bg-hover disabled:opacity-40">上一页</button><span>{pagination.page || 1} / {pagination.totalPages || 1}</span><button type="button" disabled={!pagination.hasNext || logsLoading} onClick={() => changeLogPage(pagination.page + 1)} className="rounded-md border border-border px-2 py-1 hover:bg-bg-hover disabled:opacity-40">下一页</button></div></div>
              </Card>
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
