"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "./Card";

const EMPTY_FILTERS = { startDate: "", endDate: "", apiKey: "", provider: "", logType: "" };
const formatNumber = (value) => new Intl.NumberFormat().format(Number(value || 0));
const formatCost = (value) => `$${Number(value || 0).toFixed(6)}`;

export default function RequestLogger() {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, totalPages: 0 });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [keys, setKeys] = useState([]);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(async (showLoading = true, page = 1) => {
    if (showLoading) setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "50" });
      Object.entries(filters).forEach(([key, value]) => value && query.set(key, value));
      const res = await fetch(`/api/usage/request-logs?${query.toString()}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setLogs(data.logs || []);
      setPagination(data.pagination || { page, pageSize: 50, totalPages: 0 });
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetch("/api/keys", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((d) => setKeys(d?.keys || [])).catch(() => {});
    fetch("/api/providers", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((d) => setProviders([...new Set((d?.connections || []).map((c) => c.provider).filter(Boolean))].sort())).catch(() => {});
  }, []);

  useEffect(() => { fetchLogs(true, 1); }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const interval = setInterval(() => fetchLogs(false, pagination.page), 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs, pagination.page]);

  const updateFilter = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs text-text-muted">Start date<input type="datetime-local" value={filters.startDate} onChange={(e) => updateFilter("startDate", e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg-base px-2 py-1.5 text-xs text-text-main" /></label>
          <label className="text-xs text-text-muted">End date<input type="datetime-local" value={filters.endDate} onChange={(e) => updateFilter("endDate", e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg-base px-2 py-1.5 text-xs text-text-main" /></label>
          <label className="text-xs text-text-muted">API key<select value={filters.apiKey} onChange={(e) => updateFilter("apiKey", e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg-base px-2 py-1.5 text-xs text-text-main"><option value="">All keys</option>{keys.map((key) => <option key={key.id} value={key.id}>{key.name}</option>)}</select></label>
          <label className="text-xs text-text-muted">Provider<select value={filters.provider} onChange={(e) => updateFilter("provider", e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg-base px-2 py-1.5 text-xs text-text-main"><option value="">All providers</option>{providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label>
          <label className="text-xs text-text-muted">Log type<select value={filters.logType} onChange={(e) => updateFilter("logType", e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg-base px-2 py-1.5 text-xs text-text-main"><option value="">All types</option><option value="ok">Success</option><option value="error">Error</option><option value="failed">Failed</option></select></label>
        </div>
        <div className="flex items-center gap-2 text-xs text-text-muted"><button onClick={() => setFilters(EMPTY_FILTERS)} className="rounded-md border border-border px-2.5 py-1.5 hover:bg-bg-hover">Reset</button><button onClick={() => setAutoRefresh((value) => !value)} className={`rounded-md border px-2.5 py-1.5 ${autoRefresh ? "border-primary text-primary" : "border-border"}`}>{autoRefresh ? "Auto refresh" : "Paused"}</button></div>
      </div>

      <Card className="overflow-hidden">
        <div className="max-h-[680px] overflow-auto">
          {loading && !logs.length ? <div className="p-8 text-center text-text-muted">Loading logs...</div> : !logs.length ? <div className="p-8 text-center text-text-muted">No logs recorded yet.</div> : (
            <table className="w-full min-w-[1180px] border-collapse text-xs">
              <thead className="sticky top-0 z-10 border-b border-border bg-bg-subtle text-text-muted"><tr><th className="px-3 py-2 text-left">Time</th><th className="px-3 py-2 text-left">API key</th><th className="px-3 py-2 text-left">Model</th><th className="px-3 py-2 text-left">Provider</th><th className="px-3 py-2 text-left">Endpoint</th><th className="px-3 py-2 text-right">Input</th><th className="px-3 py-2 text-right">Cache read</th><th className="px-3 py-2 text-right">Cache write</th><th className="px-3 py-2 text-right">Output</th><th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
              <tbody className="divide-y divide-border/60">{logs.map((log) => <tr key={log.id} className="hover:bg-bg-hover/60"><td className="whitespace-nowrap px-3 py-2 text-text-muted">{new Date(log.timestamp).toLocaleString()}</td><td className="px-3 py-2">{log.apiKeyName}</td><td className="px-3 py-2 font-mono">{log.model || "-"}</td><td className="px-3 py-2">{log.provider || "-"}</td><td className="px-3 py-2">{log.endpoint || "-"}</td><td className="px-3 py-2 text-right text-primary">{formatNumber(log.inputTokens)}</td><td className="px-3 py-2 text-right text-sky-500">{formatNumber(log.cacheReadTokens)}</td><td className="px-3 py-2 text-right text-cyan-500">{formatNumber(log.cacheCreationTokens)}</td><td className="px-3 py-2 text-right text-success">{formatNumber(log.outputTokens)}</td><td className="px-3 py-2 text-right text-warning">{formatCost(log.cost)}</td><td className={`px-3 py-2 font-semibold ${log.status === "ok" || log.status === "success" ? "text-success" : "text-error"}`}>{log.status}</td></tr>)}</tbody>
            </table>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-text-muted"><span>{pagination.totalItems || 0} records</span><div className="flex items-center gap-2"><button disabled={!pagination.hasPrev} onClick={() => fetchLogs(true, pagination.page - 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">Previous</button><span>{pagination.page || 1} / {pagination.totalPages || 1}</span><button disabled={!pagination.hasNext} onClick={() => fetchLogs(true, pagination.page + 1)} className="rounded border border-border px-2 py-1 disabled:opacity-40">Next</button></div></div>
      </Card>
    </div>
  );
}
