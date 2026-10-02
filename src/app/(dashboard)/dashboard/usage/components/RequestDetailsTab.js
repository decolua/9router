"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Drawer from "@/shared/components/Drawer";
import Pagination from "@/shared/components/Pagination";
import Badge from "@/shared/components/Badge";
import { cn } from "@/shared/utils/cn";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";

let providerNameCache = null;
let providerNodesCache = null;

async function fetchProviderNames() {
  if (providerNameCache && providerNodesCache) {
    return { providerNameCache, providerNodesCache };
  }

  try {
    const nodesRes = await fetch("/api/provider-nodes");
    const nodesData = await nodesRes.json();
    const nodes = nodesData.nodes || [];
    providerNodesCache = {};

    for (const node of nodes) {
      providerNodesCache[node.id] = node.name;
    }

    providerNameCache = {
      ...AI_PROVIDERS,
      ...providerNodesCache
    };
  } catch {
    providerNameCache = AI_PROVIDERS;
    providerNodesCache = {};
  }

  return { providerNameCache, providerNodesCache };
}

function getProviderName(providerId, cache) {
  if (!providerId) return "—";
  if (!cache) return providerId;

  const cached = cache[providerId];

  if (typeof cached === "string") {
    return cached;
  }

  if (cached?.name) {
    return cached.name;
  }

  const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
  return providerConfig?.name || providerId;
}

function CollapsibleSection({ title, children, defaultOpen = false, icon = null }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  return (
    <div className="border border-black/5 dark:border-white/5 rounded-lg overflow-hidden">
      <button 
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 bg-black/[0.02] dark:bg-white/[0.02] hover:bg-black/[0.04] dark:hover:bg-white/[0.04] transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon && <span className="material-symbols-outlined text-[18px] text-text-muted">{icon}</span>}
          <span className="font-semibold text-sm text-text-main">{title}</span>
        </div>
        <span className={cn(
          "material-symbols-outlined text-[20px] text-text-muted transition-transform duration-200",
          isOpen ? "rotate-90" : ""
        )}>
          chevron_right
        </span>
      </button>
      
      {isOpen && (
        <div className="p-4 border-t border-black/5 dark:border-white/5">
          {children}
        </div>
      )}
    </div>
  );
}

function getCachedTokens(tokens) {
  return tokens?.cached_tokens || tokens?.cache_read_input_tokens || 0;
}

function getCacheCreationTokens(tokens) {
  return tokens?.cache_creation_input_tokens || 0;
}

function getInputTokens(tokens) {
  const prompt = tokens?.prompt_tokens || tokens?.input_tokens || 0;
  const cache = getCachedTokens(tokens);
  return prompt < cache ? cache : prompt;
}

function getOutputTokens(tokens) {
  return tokens?.completion_tokens || tokens?.output_tokens || 0;
}

function getTotalTokens(tokens) {
  if (tokens?.total_tokens !== undefined) return tokens.total_tokens;
  return getInputTokens(tokens) + getOutputTokens(tokens);
}

export default function RequestDetailsTab() {
  const [details, setDetails] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0
  });
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [providers, setProviders] = useState([]);
  const [providerNameCache, setProviderNameCache] = useState(null);

  const [filters, setFilters] = useState({
    apiKey: "",
    model: "",
    status: "all",
    provider: "",
    startDate: "",
    endDate: ""
  });

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/usage/providers");
      const data = await res.json();
      setProviders(data.providers || []);

      const cache = await fetchProviderNames();
      setProviderNameCache(cache.providerNameCache);
    } catch (error) {
      console.error("Failed to fetch providers:", error);
    }
  }, []);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString()
      });
      if (filters.apiKey) params.append("apiKey", filters.apiKey.trim());
      if (filters.model) params.append("model", filters.model.trim());
      if (filters.status && filters.status !== "all") params.append("status", filters.status);
      if (filters.provider) params.append("provider", filters.provider);
      if (filters.startDate) params.append("startDate", filters.startDate);
      if (filters.endDate) params.append("endDate", filters.endDate);

      const res = await fetch(`/api/usage/request-details?${params}`);
      const data = await res.json();

      setDetails(data.details || []);
      setPagination(prev => ({ ...prev, ...data.pagination }));
    } catch (error) {
      console.error("Failed to fetch request details:", error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, filters]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const handleViewDetail = async (detail) => {
    setSelectedDetail(detail);
    setIsDrawerOpen(true);
    setDetailLoading(true);

    try {
      // Fetch full unredacted request detail for prompt and response inspection
      const res = await fetch(`/api/usage/request-details/${detail.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.detail) {
          setSelectedDetail(data.detail);
        }
      }
    } catch (error) {
      console.error("Failed to load unredacted detail:", error);
    } finally {
      setDetailLoading(false);
    }
  };

  const handlePageChange = (newPage) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  };

  const handlePageSizeChange = (newPageSize) => {
    setPagination(prev => ({ ...prev, pageSize: newPageSize, page: 1 }));
  };

  const handleClearFilters = () => {
    setFilters({
      apiKey: "",
      model: "",
      status: "all",
      provider: "",
      startDate: "",
      endDate: ""
    });
  };

  const hasActiveFilters = Boolean(
    filters.apiKey ||
    filters.model ||
    filters.status !== "all" ||
    filters.provider ||
    filters.startDate ||
    filters.endDate
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Filter Bar */}
      <Card padding="md">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="key-filter" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Customer / Key
            </label>
            <input
              id="key-filter"
              type="text"
              placeholder="Search customer or key..."
              value={filters.apiKey}
              onChange={(e) => setFilters({ ...filters, apiKey: e.target.value })}
              className={cn(
                "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20",
                "w-full min-w-0"
              )}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="model-filter" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Model
            </label>
            <input
              id="model-filter"
              type="text"
              placeholder="e.g. deepseek, qwen..."
              value={filters.model}
              onChange={(e) => setFilters({ ...filters, model: e.target.value })}
              className={cn(
                "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20",
                "w-full min-w-0"
              )}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="status-filter" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Status
            </label>
            <select
              id="status-filter"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
              className={cn(
                "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20",
                "w-full min-w-0 cursor-pointer"
              )}
            >
              <option value="all">All Statuses</option>
              <option value="success">Success</option>
              <option value="error">Error</option>
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="provider-filter" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Provider
            </label>
            <select
              id="provider-filter"
              value={filters.provider}
              onChange={(e) => setFilters({ ...filters, provider: e.target.value })}
              className={cn(
                "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20",
                "w-full min-w-0 cursor-pointer"
              )}
            >
              <option value="">All Providers</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="start-date-filter" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Start Date
            </label>
            <input
              id="start-date-filter"
              type="datetime-local"
              value={filters.startDate}
              onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              className={cn(
                "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "w-full min-w-0 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20"
              )}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor="end-date-filter" className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              End Date
            </label>
            <input
              id="end-date-filter"
              type="datetime-local"
              value={filters.endDate}
              onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              className={cn(
                "h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface",
                "w-full min-w-0 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/20"
              )}
            />
          </div>
        </div>

        {hasActiveFilters && (
          <div className="flex justify-end mt-3 pt-3 border-t border-black/5 dark:border-white/5">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
            >
              Clear Filters
            </Button>
          </div>
        )}
      </Card>

      {/* Requests Table */}
      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead>
              <tr className="border-b border-black/5 dark:border-white/5 text-xs uppercase tracking-wider text-text-muted">
                <th className="text-left p-4 font-semibold">Timestamp</th>
                <th className="text-left p-4 font-semibold">Customer / Key</th>
                <th className="text-left p-4 font-semibold">Model</th>
                <th className="text-left p-4 font-semibold">Status</th>
                <th className="text-right p-4 font-semibold">Tokens (In / Out)</th>
                <th className="text-right p-4 font-semibold">Cost</th>
                <th className="text-left p-4 font-semibold">Latency</th>
                <th className="text-left p-4 font-semibold">IP</th>
                <th className="text-center p-4 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9" className="p-8 text-center text-text-muted">
                    <div className="flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                      Loading requests...
                    </div>
                  </td>
                </tr>
              ) : details.length === 0 ? (
                <tr>
                  <td colSpan="9" className="p-8 text-center text-text-muted">
                    No request details found
                  </td>
                </tr>
              ) : (
                details.map((detail, index) => {
                  const isSuccess = detail.status === "success" || detail.status === 200;
                  const inTokens = getInputTokens(detail.tokens);
                  const outTokens = getOutputTokens(detail.tokens);
                  const totalTokens = getTotalTokens(detail.tokens);
                  const costFormatted = typeof detail.cost === "number" && detail.cost > 0
                    ? `$${detail.cost.toFixed(5)}`
                    : "—";

                  return (
                    <tr
                      key={`${detail.id}-${index}`}
                      className="border-b border-black/5 dark:border-white/5 last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="whitespace-nowrap p-4 text-xs text-text-muted">
                        {new Date(detail.timestamp).toLocaleString()}
                      </td>

                      <td className="p-4 text-sm text-text-main">
                        <div className="flex flex-col">
                          <span className="font-medium">
                            {detail.customer || (detail.apiKey ? detail.apiKey.substring(0, 10) + "..." : "Anonymous")}
                          </span>
                          {detail.customer && detail.apiKey && (
                            <code className="text-[11px] text-text-muted font-mono">
                              {detail.apiKey.substring(0, 8)}...
                            </code>
                          )}
                        </div>
                      </td>

                      <td className="max-w-[220px] truncate p-4 font-mono text-sm text-text-main">
                        <div>{detail.model || "—"}</div>
                        <div className="text-xs text-text-muted font-sans mt-0.5">
                          {getProviderName(detail.provider, providerNameCache)}
                        </div>
                      </td>

                      <td className="p-4 text-sm">
                        <Badge
                          size="sm"
                          variant={isSuccess ? "success" : "error"}
                        >
                          {isSuccess ? "Success" : (detail.status || "Error")}
                        </Badge>
                      </td>

                      <td className="p-4 text-sm text-right font-mono">
                        <div className="text-text-main">
                          {inTokens.toLocaleString()} / {outTokens.toLocaleString()}
                        </div>
                        <div className="text-xs text-text-muted">
                          Total: {totalTokens.toLocaleString()}
                        </div>
                      </td>

                      <td className="p-4 text-sm text-right font-mono text-text-main">
                        {costFormatted}
                      </td>

                      <td className="p-4 text-xs text-text-muted font-mono">
                        <div>TTFT: {detail.latency?.ttft || 0}ms</div>
                        <div>Total: {detail.latency?.total || 0}ms</div>
                      </td>

                      <td className="p-4 text-xs font-mono text-text-muted">
                        {detail.ip || "—"}
                      </td>

                      <td className="p-4 text-center">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewDetail(detail)}
                        >
                          Detail
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && details.length > 0 && (
          <div className="border-t border-black/5 dark:border-white/5">
            <Pagination
              currentPage={pagination.page}
              pageSize={pagination.pageSize}
              totalItems={pagination.totalItems}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          </div>
        )}
      </Card>

      {/* Drawer: Full Unredacted Detail Inspection */}
      <Drawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        title="Request Details & Content"
        width="lg"
      >
        {selectedDetail && (
          <div className="space-y-6">
            {detailLoading && (
              <div className="flex items-center gap-2 p-2 rounded bg-primary/10 text-primary text-xs">
                <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                Loading full unredacted prompt and response...
              </div>
            )}

            {/* Error Banner if request failed */}
            {(selectedDetail.error || (selectedDetail.status && selectedDetail.status !== "success" && selectedDetail.status !== 200)) && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
                <div className="flex items-center gap-2 mb-1.5 text-red-600 dark:text-red-400 font-semibold text-sm">
                  <span className="material-symbols-outlined text-[20px]">error</span>
                  Request Error ({selectedDetail.status || "Failed"})
                </div>
                <pre className="text-xs font-mono text-red-600 dark:text-red-300 overflow-auto whitespace-pre-wrap">
                  {typeof selectedDetail.error === "object"
                    ? JSON.stringify(selectedDetail.error, null, 2)
                    : (selectedDetail.error || "Request failed")}
                </pre>
              </div>
            )}

            {/* Overview Metadata Grid */}
            <div className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2 bg-surface-2 p-4 rounded-xl border border-black/5 dark:border-white/5">
              <div>
                <span className="text-xs text-text-muted block">Request ID</span>
                <span className="break-all font-mono text-xs text-text-main">{selectedDetail.id}</span>
              </div>
              <div>
                <span className="text-xs text-text-muted block">Timestamp</span>
                <span className="text-xs text-text-main">{new Date(selectedDetail.timestamp).toLocaleString()}</span>
              </div>
              <div>
                <span className="text-xs text-text-muted block">Customer / Key</span>
                <span className="text-xs text-text-main font-medium">
                  {selectedDetail.customer ? `${selectedDetail.customer} (${selectedDetail.apiKey || "Key"})` : (selectedDetail.apiKey || "Anonymous")}
                </span>
              </div>
              <div>
                <span className="text-xs text-text-muted block">Client IP</span>
                <span className="text-xs font-mono text-text-main">{selectedDetail.ip || "—"}</span>
              </div>
              <div>
                <span className="text-xs text-text-muted block">Model</span>
                <span className="text-xs font-mono text-text-main font-semibold">{selectedDetail.model}</span>
              </div>
              <div>
                <span className="text-xs text-text-muted block">Provider</span>
                <span className="text-xs text-text-main font-medium">{getProviderName(selectedDetail.provider, providerNameCache)}</span>
              </div>
              <div>
                <span className="text-xs text-text-muted block">Status</span>
                <span className={cn(
                  "text-xs font-semibold",
                  (selectedDetail.status === "success" || selectedDetail.status === 200) ? "text-green-600" : "text-red-600"
                )}>
                  {selectedDetail.status}
                </span>
              </div>
              <div>
                <span className="text-xs text-text-muted block">Cost</span>
                <span className="text-xs font-mono text-text-main font-medium">
                  {typeof selectedDetail.cost === "number" ? `$${selectedDetail.cost.toFixed(6)}` : "$0.00"}
                </span>
              </div>
              <div>
                <span className="text-xs text-text-muted block">Tokens (In / Out / Total)</span>
                <span className="text-xs font-mono text-text-main">
                  {getInputTokens(selectedDetail.tokens).toLocaleString()} / {getOutputTokens(selectedDetail.tokens).toLocaleString()} (Total: {getTotalTokens(selectedDetail.tokens).toLocaleString()})
                </span>
              </div>
              <div>
                <span className="text-xs text-text-muted block">Latency</span>
                <span className="text-xs font-mono text-text-main">
                  TTFT {selectedDetail.latency?.ttft || 0}ms / Total {selectedDetail.latency?.total || 0}ms
                </span>
              </div>
            </div>

            {/* PXPIPE Image Optimization */}
            {selectedDetail.pxpipe && (
              <div className="rounded-lg border border-black/5 dark:border-white/5 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-[18px] text-text-muted">image</span>
                  <span className="font-semibold text-sm text-text-main">PXPIPE Optimization</span>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded",
                    selectedDetail.pxpipe.applied
                      ? "bg-green-500/15 text-green-600"
                      : "bg-amber-500/15 text-amber-600"
                  )}>
                    {selectedDetail.pxpipe.applied ? "Activated" : "Skipped"}
                  </span>
                </div>
                {selectedDetail.pxpipe.applied ? (
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <span className="text-text-muted block text-xs">Original (est.)</span>
                      <span className="font-mono">{(selectedDetail.pxpipe.tokensBeforeEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Compressed (est.)</span>
                      <span className="font-mono">{(selectedDetail.pxpipe.tokensAfterEst || 0).toLocaleString()} tokens</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Saved</span>
                      <span className="font-mono text-green-600">{selectedDetail.pxpipe.savedPct || 0}%</span>
                    </div>
                    <div>
                      <span className="text-text-muted block text-xs">Images</span>
                      <span className="font-mono">{selectedDetail.pxpipe.imageCount || 0} ({selectedDetail.pxpipe.durationMs || 0}ms)</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">
                    Reason: <span className="font-mono">{selectedDetail.pxpipe.reason}</span>
                    {selectedDetail.pxpipe.detail ? ` — ${selectedDetail.pxpipe.detail}` : ""}
                  </p>
                )}
              </div>
            )}

            {/* Prompt & Messages View */}
            {selectedDetail.request?.messages && Array.isArray(selectedDetail.request.messages) && (
              <CollapsibleSection
                title={`Conversation Messages (${selectedDetail.request.messages.length})`}
                defaultOpen={true}
                icon="forum"
              >
                <div className="flex flex-col gap-3">
                  {selectedDetail.request.messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] p-3"
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider",
                          msg.role === "system" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" :
                          msg.role === "user" ? "bg-blue-500/15 text-blue-700 dark:text-blue-300" :
                          msg.role === "assistant" ? "bg-purple-500/15 text-purple-700 dark:text-purple-300" :
                          "bg-surface-2 text-text-muted"
                        )}>
                          {msg.role}
                        </span>
                        {msg.name && (
                          <span className="text-xs text-text-muted font-mono">{msg.name}</span>
                        )}
                      </div>
                      <div className="font-mono text-xs whitespace-pre-wrap break-words text-text-main">
                        {typeof msg.content === "string"
                          ? msg.content
                          : JSON.stringify(msg.content, null, 2)}
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Full Payload Sections */}
            <div className="space-y-4">
              <CollapsibleSection title="1. Full Client Request Payload" defaultOpen={!selectedDetail.request?.messages} icon="input">
                <pre className="max-h-[350px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                  {JSON.stringify(selectedDetail.request, null, 2)}
                </pre>
              </CollapsibleSection>

              {selectedDetail.providerRequest && (
                <CollapsibleSection title="2. Upstream Provider Request" icon="translate">
                  <pre className="max-h-[350px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                    {JSON.stringify(selectedDetail.providerRequest, null, 2)}
                  </pre>
                </CollapsibleSection>
              )}

              {selectedDetail.providerResponse && (
                <CollapsibleSection title="3. Upstream Provider Response" icon="data_object">
                  <pre className="max-h-[350px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                    {typeof selectedDetail.providerResponse === "object"
                      ? JSON.stringify(selectedDetail.providerResponse, null, 2)
                      : selectedDetail.providerResponse}
                  </pre>
                </CollapsibleSection>
              )}
              
              <CollapsibleSection title="4. Final Client Response" defaultOpen={true} icon="output">
                {selectedDetail.response?.thinking && (
                  <div className="mb-4">
                    <h4 className="font-semibold text-text-main mb-1.5 flex items-center gap-1.5 text-xs uppercase tracking-wide opacity-75">
                      <span className="material-symbols-outlined text-[16px] text-amber-500">psychology</span>
                      Thinking Process
                    </h4>
                    <pre className="max-h-[220px] max-w-full overflow-auto rounded-lg border border-amber-200 bg-amber-50 p-3 font-mono text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 sm:p-4">
                      {selectedDetail.response.thinking}
                    </pre>
                  </div>
                )}
                
                {selectedDetail.response?.content && (
                  <div className="mb-3">
                    <h4 className="font-semibold text-text-main mb-1.5 text-xs uppercase tracking-wide opacity-75">
                      Content
                    </h4>
                    <pre className="max-h-[350px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4 whitespace-pre-wrap">
                      {selectedDetail.response.content}
                    </pre>
                  </div>
                )}

                <h4 className="font-semibold text-text-muted mb-1 text-xs uppercase tracking-wide opacity-75">
                  Raw Response Object
                </h4>
                <pre className="max-h-[250px] max-w-full overflow-auto rounded-lg border border-black/5 bg-black/5 p-3 font-mono text-xs text-text-main dark:border-white/5 dark:bg-white/5 sm:p-4">
                  {JSON.stringify(selectedDetail.response, null, 2)}
                </pre>
              </CollapsibleSection>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
