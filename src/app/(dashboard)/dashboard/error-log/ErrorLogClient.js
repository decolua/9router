"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Drawer from "@/shared/components/Drawer";
import Pagination from "@/shared/components/Pagination";
import { cn } from "@/shared/utils/cn";
import { AI_PROVIDERS } from "@/shared/constants/providers";

function formatError(text) {
  if (!text) return null;
  if (typeof text !== "string") {
    try {
      text = JSON.stringify(text);
    } catch {
      text = String(text);
    }
  }
  if (text.length > 240) return `${text.slice(0, 237)}...`;
  return text;
}

export default function ErrorLogClient() {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [filters, setFilters] = useState({
    provider: "",
    model: "",
    connectionId: "",
    comboName: "",
    statusCode: ""
  });
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(pagination.page),
        pageSize: String(pagination.pageSize)
      });
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.append(key, value);
      }

      const res = await fetch(`/api/usage/error-logs?${params}`);
      const data = await res.json();
      setLogs(data.details || []);
      setPagination((prev) => ({ ...prev, ...data.pagination }));
    } catch (error) {
      console.error("Failed to fetch error logs:", error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, filters]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(fetchLogs, 4000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchLogs]);

  const handleClearFilters = () => {
    setFilters({ provider: "", model: "", connectionId: "", comboName: "", statusCode: "" });
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const renderMetaChips = (meta) => {
    if (!meta) return null;
    const chips = [];
    if (meta.fallback) chips.push({ label: "Fallback", variant: "danger" });
    if (meta.retryAfterHuman) chips.push({ label: `Retry in ${meta.retryAfterHuman}`, variant: "warning" });
    return chips;
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card padding="md">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <div className="flex min-w-0 flex-col gap-2">
              <label className="text-sm font-medium text-text-main">Provider</label>
              <input
                value={filters.provider}
                onChange={(event) => {
                  setFilters((prev) => ({ ...prev, provider: event.target.value }));
                  setPagination((prev) => ({ ...prev, page: 1 }));
                }}
                placeholder="All providers"
                className={cn(
                  "h-9 rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main dark:border-white/10",
                  "placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
                )}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <label className="text-sm font-medium text-text-main">Model</label>
              <input
                value={filters.model}
                onChange={(event) => {
                  setFilters((prev) => ({ ...prev, model: event.target.value }));
                  setPagination((prev) => ({ ...prev, page: 1 }));
                }}
                placeholder="All models"
                className={cn(
                  "h-9 rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main dark:border-white/10",
                  "placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
                )}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <label className="text-sm font-medium text-text-main">Combo</label>
              <input
                value={filters.comboName}
                onChange={(event) => {
                  setFilters((prev) => ({ ...prev, comboName: event.target.value }));
                  setPagination((prev) => ({ ...prev, page: 1 }));
                }}
                placeholder="All combos"
                className={cn(
                  "h-9 rounded-lg border border-black/10 bg-surface px-3 text-sm text-text-main dark:border-white/10",
                  "placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
                )}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <label className="text-sm font-medium text-text-main">Status</label>
              <input
                value={filters.statusCode}
                onChange={(event) => {
                  setFilters((prev) => ({ ...prev, statusCode: event.target.value }));
                  setPagination((prev) => ({ ...prev, page: 1 }));
                }}
                placeholder="e.g. 502"
                className={cn(
                  "h-9 rounded-lg border border-black/10 bg-surface px-3 font-mono text-sm text-text-main dark:border-white/10",
                  "placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
                )}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <label className="text-sm font-medium text-text-main">Account</label>
              <input
                value={filters.connectionId}
                onChange={(event) => {
                  setFilters((prev) => ({ ...prev, connectionId: event.target.value }));
                  setPagination((prev) => ({ ...prev, page: 1 }));
                }}
                placeholder="All accounts"
                className={cn(
                  "h-9 rounded-lg border border-black/10 bg-surface px-3 font-mono text-sm text-text-main dark:border-white/10",
                  "placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
                )}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setAutoRefresh((prev) => !prev);
              }}
            >
              {autoRefresh ? "Pause live refresh" : "Resume live refresh"}
            </Button>
            <Button
              variant="outline"
              onClick={handleClearFilters}
              disabled={!Object.values(filters).some((value) => value)}
            >
              Clear filters
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="min-w-[860px] w-full">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/5">
                <th className="text-left p-4 text-sm font-semibold text-text-main">Timestamp</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Endpoint / Combo</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Model</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Provider</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Account</th>
                <th className="text-center p-4 text-sm font-semibold text-text-main">Status</th>
                <th className="text-left p-4 text-sm font-semibold text-text-main">Error</th>
                <th className="text-center p-4 text-sm font-semibold text-text-main">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && logs.length === 0 ? (
                <tr>
                  <td colSpan="8" className="p-8 text-center text-text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                      Loading error logs...
                    </div>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan="8" className="p-8 text-center text-text-muted">
                    No error logs match the current filters.
                  </td>
                </tr>
              ) : (
                logs.map((logItem) => {
                  const chips = renderMetaChips(logItem.meta);
                  return (
                    <tr
                      key={logItem.id}
                      className="border-b border-black/5 dark:border-white/5 last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="whitespace-nowrap p-4 text-sm text-text-main">
                        {new Date(logItem.timestamp).toLocaleString()}
                      </td>
                      <td className="max-w-[220px] truncate p-4 text-sm text-text-main">
                        <div className="flex flex-col gap-1">
                          <span className="font-mono text-xs text-text-muted">{logItem.endpoint || "/v1/chat/completions"}</span>
                          {logItem.comboName ? (
                            <span className="inline-flex w-fit items-center rounded-md border border-black/10 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-white/10 dark:text-amber-300">
                              Combo: {logItem.comboName}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="max-w-[180px] truncate p-4 text-sm font-mono text-text-main">{logItem.model}</td>
                      <td className="max-w-[160px] truncate p-4 text-sm text-text-main">
                        {AI_PROVIDERS[logItem.provider]?.name || logItem.provider || "Unknown provider"}
                      </td>
                      <td className="max-w-[160px] truncate p-4 font-mono text-sm text-text-main">
                        {logItem.connectionId || "—"}
                      </td>
                      <td className="whitespace-nowrap p-4 text-center text-sm">
                        <span
                          className={cn(
                            "inline-flex min-w-[3.5rem] justify-center rounded-md border px-2 py-1 font-mono text-xs",
                            logItem.statusCode && /4|5/.test(String(logItem.statusCode))
                              ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-300"
                              : "border-black/10 bg-black/5 text-text-main dark:border-white/10 dark:bg-white/5"
                          )}
                        >
                          {logItem.statusCode || "ERR"}
                        </span>
                      </td>
                      <td className="max-w-[320px] truncate p-4 text-sm text-text-main">{formatError(logItem.errorMessage)}</td>
                      <td className="p-4 text-center">
                        <Button variant="outline" size="sm" onClick={() => { setSelectedLog(logItem); setIsDrawerOpen(true); }}>
                          Inspect
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && logs.length > 0 && (
          <div className="border-t border-black/5 dark:border-white/5">
            <Pagination
              currentPage={pagination.page}
              pageSize={pagination.pageSize}
              totalItems={pagination.totalItems}
              onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
              onPageSizeChange={(pageSize) => setPagination((prev) => ({ ...prev, pageSize, page: 1 }))}
            />
          </div>
        )}
      </Card>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Error Log Details"
        width="lg"
      >
        {selectedLog && (
          <div className="space-y-6">
            <div className="grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <span className="text-text-muted">Timestamp:</span>{" "}
                <span className="text-text-main">{new Date(selectedLog.timestamp).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-text-muted">Endpoint:</span>{" "}
                <span className="font-mono text-text-main">{selectedLog.endpoint || "/v1/chat/completions"}</span>
              </div>
              <div>
                <span className="text-text-muted">Provider:</span>{" "}
                <span className="text-text-main">{AI_PROVIDERS[selectedLog.provider]?.name || selectedLog.provider || "Unknown provider"}</span>
              </div>
              <div>
                <span className="text-text-muted">Model:</span>{" "}
                <span className="font-mono text-text-main">{selectedLog.model}</span>
              </div>
              <div>
                <span className="text-text-muted">Account:</span>{" "}
                <span className="font-mono text-text-main">{selectedLog.connectionId || "—"}</span>
              </div>
              <div>
                <span className="text-text-muted">Combo:</span>{" "}
                <span className="text-text-main">{selectedLog.comboName || "—"}</span>
              </div>
              <div>
                <span className="text-text-muted">Status:</span>{" "}
                <span className={cn(
                  "font-mono font-medium",
                  selectedLog.statusCode && /4|5/.test(String(selectedLog.statusCode)) ? "text-red-600" : "text-text-main"
                )}>
                  {selectedLog.statusCode || "ERR"}
                </span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-text-muted">Error:</span>{" "}
                <span className="text-red-700 dark:text-red-300">{formatError(selectedLog.errorMessage)}</span>
              </div>
              {selectedLog.meta?.latency?.total != null ? (
                <div>
                  <span className="text-text-muted">Latency:</span>{" "}
                  <span className="font-mono text-text-main">TTFT {selectedLog.meta.latency.ttft || 0}ms / Total {selectedLog.meta.latency.total || 0}ms</span>
                </div>
              ) : null}
              {selectedLog.meta?.tokens ? (
                <div>
                  <span className="text-text-muted">Tokens:</span>{" "}
                  <span className="font-mono text-text-main">
                    {`in ${selectedLog.meta.tokens.prompt_tokens || selectedLog.meta.tokens.input_tokens || 0} / out ${selectedLog.meta.tokens.completion_tokens || selectedLog.meta.tokens.output_tokens || 0}`}
                  </span>
                </div>
              ) : null}
              {selectedLog.meta?.retryAfterHuman ? (
                <div>
                  <span className="text-text-muted">Retry after:</span>{" "}
                  <span className="font-mono text-text-main">{selectedLog.meta.retryAfterHuman}</span>
                </div>
              ) : null}
              <div className="sm:col-span-2 flex gap-2">
                {selectedLog.meta?.fallback ? (
                  <span className="inline-flex rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">Fallback event</span>
                ) : null}
              </div>
            </div>

            <div className="space-y-4">
              {selectedLog.request && (
                <Collapsible title="Client Request (Input)" defaultOpen icon="input" data={selectedLog.request} />
              )}
              {selectedLog.providerRequest && (
                <Collapsible title="Provider Request (Translated)" icon="translate" data={selectedLog.providerRequest} />
              )}
              {selectedLog.providerResponse && (
                <Collapsible title="Provider Response (Raw)" icon="data_object" data={selectedLog.providerResponse} />
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Collapsible({ title, children, defaultOpen = false, icon = null, data }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-black/5 dark:border-white/5">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex w-full items-center justify-between p-3 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
      >
        <div className="flex items-center gap-2">
          {icon && <span className="material-symbols-outlined text-[18px] text-text-muted">{icon}</span>}
          <span className="text-sm font-semibold text-text-main">{title}</span>
        </div>
        <span className={cn("material-symbols-outlined text-text-muted transition-transform", isOpen ? "rotate-90" : "")}>
          chevron_right
        </span>
      </button>
      {isOpen && (
        <div className="space-y-0 border-t border-black/5 p-4 dark:border-white/5">
          {children ?? (
            <pre className="max-h-[280px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs dark:border-white/5 dark:bg-white/5">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
