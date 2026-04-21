"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ProviderIcon from "@/shared/components/ProviderIcon";
import QuotaTable from "./QuotaTable";
import Toggle from "@/shared/components/Toggle";
import { parseQuotaData, calculatePercentage } from "./utils";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import Select from "@/shared/components/Select";
import Pagination from "@/shared/components/Pagination";
import { EditConnectionModal } from "@/shared/components";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";
import { getConnectionFilterStatus, normalizeConnectionFilterStatus } from "@/lib/connectionStatus";
import { createSingleFlight, runWithConcurrency } from "./refreshQueue";

const DEFAULT_PAGE_SIZE = 24;
const QUOTA_REFRESH_CONCURRENCY = 4;

const REFRESH_INTERVAL_MS = 60000; // 60 seconds

function getSupportedOAuthConnections(connections = []) {
  return connections.filter(
    (conn) => USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) && conn.authType === "oauth",
  );
}

function filterVisibleConnections(connections = [], searchQuery = "", statusFilter = "all") {
  const query = searchQuery.trim().toLowerCase();

  return connections.filter((conn) => {
    const status = getConnectionFilterStatus(conn);
    const matchesSearch = !query || [conn.provider, conn.name, conn.displayName, conn.email, conn.connectionName, conn.id]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
    const matchesStatus = statusFilter === "all" || status === statusFilter;

    return matchesSearch && matchesStatus;
  });
}

function sortConnectionsByProvider(connections = []) {
  return [...connections].sort((a, b) => {
    const orderA = USAGE_SUPPORTED_PROVIDERS.indexOf(a.provider);
    const orderB = USAGE_SUPPORTED_PROVIDERS.indexOf(b.provider);
    if (orderA !== orderB) return orderA - orderB;
    return a.provider.localeCompare(b.provider);
  });
}

function getPaginatedConnections(connections = [], currentPage = 1, pageSize = DEFAULT_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(connections.length / pageSize));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);

  return connections.slice((safePage - 1) * pageSize, safePage * pageSize);
}

export default function ProviderLimits() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connections, setConnections] = useState([]);
  const [quotaData, setQuotaData] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [togglingId, setTogglingId] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [proxyPools, setProxyPools] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const searchQuery = searchParams.get("searchQuery") || "";
  const rawStatusFilter = searchParams.get("statusFilter");
  const statusFilter = normalizeConnectionFilterStatus(rawStatusFilter || "all");

  const intervalRef = useRef(null);
  const countdownRef = useRef(null);
  const runRefreshSingleFlightRef = useRef(null);

  if (!runRefreshSingleFlightRef.current) {
    runRefreshSingleFlightRef.current = createSingleFlight();
  }

  const updateQueryParams = useCallback((updates) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });

    const query = params.toString();
    const targetPath = pathname || "/dashboard/usage";
    router.replace(query ? `${targetPath}?${query}` : targetPath, {
      scroll: false,
    });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!rawStatusFilter) return;

    const normalizedStatusFilter = normalizeConnectionFilterStatus(rawStatusFilter);
    if (normalizedStatusFilter === rawStatusFilter) return;

    updateQueryParams({
      statusFilter: normalizedStatusFilter === "all" ? null : normalizedStatusFilter,
    });
  }, [rawStatusFilter, updateQueryParams]);

  // Fetch all provider connections
  const fetchConnections = useCallback(async () => {
    try {
      const response = await fetch("/api/providers/client");
      if (!response.ok) throw new Error("Failed to fetch connections");

      const data = await response.json();
      const connectionList = data.connections || [];
      setConnections(connectionList);
      return connectionList;
    } catch (error) {
      console.error("Error fetching connections:", error);
      setConnections([]);
      return [];
    }
  }, []);

  // Fetch quota for a specific connection
  const fetchQuota = useCallback(async (connectionId, provider) => {
    setLoading((prev) => ({ ...prev, [connectionId]: true }));
    setErrors((prev) => ({ ...prev, [connectionId]: null }));

    try {
      console.log(
        `[ProviderLimits] Fetching quota for ${provider} (${connectionId})`,
      );
      const response = await fetch(`/api/usage/${connectionId}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || response.statusText;

        // Handle different error types gracefully
        if (response.status === 404) {
          // Connection not found - skip silently
          console.warn(
            `[ProviderLimits] Connection not found for ${provider}, skipping`,
          );
          return;
        }

        if (response.status === 401) {
          // Auth error - show message instead of throwing
          console.warn(
            `[ProviderLimits] Auth error for ${provider}:`,
            errorMsg,
          );
          setQuotaData((prev) => ({
            ...prev,
            [connectionId]: {
              quotas: [],
              message: errorMsg,
            },
          }));
          return;
        }

        throw new Error(`HTTP ${response.status}: ${errorMsg}`);
      }

      const data = await response.json();
      console.log(`[ProviderLimits] Got quota for ${provider}:`, data);

      // Parse quota data using provider-specific parser
      const parsedQuotas = parseQuotaData(provider, data);

      setQuotaData((prev) => ({
        ...prev,
        [connectionId]: {
          quotas: parsedQuotas,
          plan: data.plan || null,
          message: data.message || null,
          raw: data,
        },
      }));
    } catch (error) {
      console.error(
        `[ProviderLimits] Error fetching quota for ${provider} (${connectionId}):`,
        error,
      );
      setErrors((prev) => ({
        ...prev,
        [connectionId]: error.message || "Failed to fetch quota",
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [connectionId]: false }));
    }
  }, []);

  // Refresh quota for a specific provider
  const refreshProvider = useCallback(
    async (connectionId, provider) => {
      await fetchQuota(connectionId, provider);
      setLastUpdated(new Date());
    },
    [fetchQuota],
  );

  const refreshConnectionBatch = useCallback(
    async (connectionBatch = []) => runWithConcurrency(
      connectionBatch,
      QUOTA_REFRESH_CONCURRENCY,
      async (conn) => fetchQuota(conn.id, conn.provider),
    ),
    [fetchQuota],
  );

  const refreshConnectionsPrioritized = useCallback(
    async (connectionList = [], options = {}) => {
      const { prioritizeVisiblePage = false } = options;
      const supportedConnections = getSupportedOAuthConnections(connectionList);
      if (supportedConnections.length === 0) return;

      if (!prioritizeVisiblePage) {
        await refreshConnectionBatch(supportedConnections);
        return;
      }

      const sortedVisible = sortConnectionsByProvider(
        filterVisibleConnections(supportedConnections, searchQuery, statusFilter),
      );
      const visiblePageConnections = getPaginatedConnections(
        sortedVisible,
        currentPage,
        DEFAULT_PAGE_SIZE,
      );
      const prioritizedIds = new Set(visiblePageConnections.map((conn) => conn.id));
      const prioritizedConnections = [
        ...visiblePageConnections,
        ...supportedConnections.filter((conn) => !prioritizedIds.has(conn.id)),
      ];

      await refreshConnectionBatch(prioritizedConnections);
    },
    [currentPage, refreshConnectionBatch, searchQuery, statusFilter],
  );

  const handleDeleteConnection = useCallback(async (id) => {
    if (!confirm("Delete this connection?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConnections((prev) => prev.filter((c) => c.id !== id));
        setQuotaData((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setLoading((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setErrors((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    } catch (error) {
      console.error("Error deleting connection:", error);
    } finally {
      setDeletingId(null);
    }
  }, []);

  const handleToggleConnectionActive = useCallback(async (id, isActive) => {
    setTogglingId(id);
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setConnections((prev) =>
          prev.map((c) => (c.id === id ? { ...c, isActive } : c)),
        );
      }
    } catch (error) {
      console.error("Error updating connection status:", error);
    } finally {
      setTogglingId(null);
    }
  }, []);

  const handleUpdateConnection = useCallback(
    async (formData) => {
      if (!selectedConnection?.id) return;
      const connectionId = selectedConnection.id;
      const provider = selectedConnection.provider;
      try {
        const res = await fetch(`/api/providers/${connectionId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formData),
        });
        if (res.ok) {
          await fetchConnections();
          setShowEditModal(false);
          setSelectedConnection(null);
          if (USAGE_SUPPORTED_PROVIDERS.includes(provider)) {
            await fetchQuota(connectionId, provider);
          }
        }
      } catch (error) {
        console.error("Error saving connection:", error);
      }
    },
    [selectedConnection, fetchConnections, fetchQuota],
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/proxy-pools?isActive=true", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data?.proxyPools) {
          setProxyPools(data.proxyPools);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh all providers
  const refreshAll = useCallback(async () => {
    return runRefreshSingleFlightRef.current(async () => {
      setRefreshingAll(true);
      setCountdown(60);

      try {
        const conns = await fetchConnections();

        await refreshConnectionsPrioritized(conns, { prioritizeVisiblePage: true });

        setLastUpdated(new Date());
      } catch (error) {
        console.error("Error refreshing all providers:", error);
      } finally {
        setRefreshingAll(false);
      }
    });
  }, [fetchConnections, refreshConnectionsPrioritized]);

  // Initial load: fetch connections first so cards render immediately, then fetch quotas
  useEffect(() => {
    const initializeData = async () => {
      setConnectionsLoading(true);
      const conns = await fetchConnections();
      setConnectionsLoading(false);

      const oauthConnections = getSupportedOAuthConnections(conns);

      // Mark all as loading before fetching
      const loadingState = {};
      oauthConnections.forEach((conn) => {
        loadingState[conn.id] = true;
      });
      setLoading(loadingState);

      await runRefreshSingleFlightRef.current(async () => {
        await refreshConnectionsPrioritized(conns, { prioritizeVisiblePage: true });
      });
      setLastUpdated(new Date());
    };

    initializeData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      return;
    }

    // Main refresh interval
    intervalRef.current = setInterval(() => {
      refreshAll();
    }, REFRESH_INTERVAL_MS);

    // Countdown interval
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) return 60;
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, refreshAll]);

  // Pause auto-refresh when tab is hidden (Page Visibility API)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
      } else if (autoRefresh) {
        // Resume auto-refresh when tab becomes visible
        intervalRef.current = setInterval(refreshAll, REFRESH_INTERVAL_MS);
        countdownRef.current = setInterval(() => {
          setCountdown((prev) => (prev <= 1 ? 60 : prev - 1));
        }, 1000);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [autoRefresh, refreshAll]);

  // Format last updated time
  const formatLastUpdated = useCallback(() => {
    if (!lastUpdated) return "Never";

    const now = new Date();
    const diffMs = now - lastUpdated;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMinutes > 0) return `${diffMinutes}m ago`;
    return "Just now";
  }, [lastUpdated]);

  const supportedConnections = connections.filter(
    (conn) => USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) && conn.authType === "oauth",
  );

  const visibleConnections = filterVisibleConnections(supportedConnections, searchQuery, statusFilter);

  const sortedConnections = sortConnectionsByProvider(visibleConnections);

  const totalPages = Math.max(1, Math.ceil(sortedConnections.length / DEFAULT_PAGE_SIZE));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const paginatedConnections = sortedConnections.slice(
    (currentPageSafe - 1) * DEFAULT_PAGE_SIZE,
    currentPageSafe * DEFAULT_PAGE_SIZE,
  );

  // Calculate summary stats
  const totalProviders = sortedConnections.length;
  const activeWithLimits = Object.values(quotaData).filter(
    (data) => data?.quotas?.length > 0,
  ).length;

  // Count low quotas (remaining < 30%)
  const lowQuotasCount = Object.values(quotaData).reduce((count, data) => {
    if (!data?.quotas) return count;

    const hasLowQuota = data.quotas.some((quota) => {
      const percentage = calculatePercentage(quota.used, quota.total);
      return percentage < 30 && quota.total > 0;
    });

    return count + (hasLowQuota ? 1 : 0);
  }, 0);

  // Empty state
  if (!connectionsLoading && supportedConnections.length === 0) {
    return (
      <Card padding="lg">
        <div className="text-center py-12">
          <span className="material-symbols-outlined text-[64px] text-text-muted opacity-20">
            cloud_off
          </span>
          <h3 className="mt-4 text-lg font-semibold text-text-primary">
            No Providers Connected
          </h3>
          <p className="mt-2 text-sm text-text-muted max-w-md mx-auto">
            Connect to providers with OAuth to track your API quota limits and
            usage.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="rounded-2xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-white/5 backdrop-blur-sm shadow-sm px-4 py-4 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-text-primary">
              Provider Limits
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              Last updated: {formatLastUpdated()}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
            <span className="inline-flex items-center rounded-full border border-black/5 dark:border-white/10 bg-surface px-3 py-1.5">
              {sortedConnections.length} matching {sortedConnections.length === 1 ? "connection" : "connections"}
            </span>
            <span className="inline-flex items-center rounded-full border border-black/5 dark:border-white/10 bg-surface px-3 py-1.5">
              {activeWithLimits} with quota data
            </span>
            <span className="inline-flex items-center rounded-full border border-black/5 dark:border-white/10 bg-surface px-3 py-1.5">
              {lowQuotasCount} low quota
            </span>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto_auto] lg:items-end">
          <Input
            label="Search accounts"
            icon="search"
            value={searchQuery}
            onChange={(e) => {
              const value = e.target.value;
              setCurrentPage(1);
              updateQueryParams({ searchQuery: value.trim() ? value : null });
            }}
            placeholder="Search by name, provider, email, or id"
            className="min-w-0"
          />

          <Select
            label="Status"
            value={statusFilter}
            onChange={(e) => {
              const nextValue = normalizeConnectionFilterStatus(e.target.value);
              setCurrentPage(1);
              updateQueryParams({ statusFilter: nextValue === "all" ? null : nextValue });
            }}
            placeholder="All"
            options={[
              { value: "all", label: "All" },
              { value: "eligible", label: "Eligible" },
              { value: "cooldown", label: "Cooldown" },
              { value: "blocked_quota", label: "Quota blocked" },
              { value: "blocked_auth", label: "Auth blocked" },
              { value: "disabled", label: "Disabled" },
              { value: "unknown", label: "Unknown" },
            ]}
            className="min-w-0"
          />

          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => setAutoRefresh((prev) => !prev)}
            className="w-full lg:w-auto"
            title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}
          >
            <span
              className={`material-symbols-outlined text-[18px] ${
                autoRefresh ? "text-primary" : "text-text-muted"
              }`}
            >
              {autoRefresh ? "toggle_on" : "toggle_off"}
            </span>
            Auto-refresh
            {autoRefresh && <span className="text-xs text-text-muted">({countdown}s)</span>}
          </Button>

          <Button
            variant="secondary"
            size="md"
            icon="refresh"
            onClick={refreshAll}
            disabled={refreshingAll}
            loading={refreshingAll}
            className="w-full lg:w-auto"
          >
            Refresh All
          </Button>
        </div>
      </div>

      {/* Provider cards: 2 columns, compact */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {paginatedConnections.map((conn) => {
          const quota = quotaData[conn.id];
          const isLoading = loading[conn.id];
          const error = errors[conn.id];

          // Use table layout for all providers
          const isInactive = conn.isActive === false;
          const rowBusy = deletingId === conn.id || togglingId === conn.id;

          return (
            <Card
              key={conn.id}
              padding="none"
              className={`min-w-0 ${isInactive ? "opacity-60" : ""}`}
            >
              <div className="px-4 py-3 border-b border-black/10 dark:border-white/10">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center overflow-hidden">
                      <ProviderIcon
                        src={`/providers/${conn.provider}.png`}
                        alt={conn.provider}
                        size={32}
                        className="object-contain"
                        fallbackText={
                          conn.provider?.slice(0, 2).toUpperCase() || "PR"
                        }
                      />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-text-primary capitalize truncate">
                        {conn.provider}
                      </h3>
                      {conn.name && (
                        <p className="text-xs text-text-muted truncate">
                          {conn.name}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => refreshProvider(conn.id, conn.provider)}
                      disabled={isLoading || rowBusy}
                      className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                      title="Refresh quota"
                    >
                      <span
                        className={`material-symbols-outlined text-[18px] text-text-muted ${isLoading ? "animate-spin" : ""}`}
                      >
                        refresh
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedConnection(conn);
                        setShowEditModal(true);
                      }}
                      disabled={rowBusy}
                      className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-text-muted hover:text-primary transition-colors disabled:opacity-50"
                      title="Edit connection"
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        edit
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteConnection(conn.id)}
                      disabled={rowBusy}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors disabled:opacity-50"
                      title="Delete connection"
                    >
                      <span
                        className={`material-symbols-outlined text-[18px] ${deletingId === conn.id ? "animate-pulse" : ""}`}
                      >
                        delete
                      </span>
                    </button>
                    <div
                      className="inline-flex items-center pl-0.5"
                      title={
                        (conn.isActive ?? true)
                          ? "Disable connection"
                          : "Enable connection"
                      }
                    >
                      <Toggle
                        size="sm"
                        checked={conn.isActive ?? true}
                        disabled={rowBusy}
                        onChange={(nextActive) =>
                          handleToggleConnectionActive(conn.id, nextActive)
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-3 py-3">
                {isLoading ? (
                  <div className="text-center py-5 text-text-muted">
                    <span className="material-symbols-outlined text-[28px] animate-spin">
                      progress_activity
                    </span>
                  </div>
                ) : error ? (
                  <div className="text-center py-5">
                    <span className="material-symbols-outlined text-[28px] text-red-500">
                      error
                    </span>
                    <p className="mt-1.5 text-xs text-text-muted">{error}</p>
                  </div>
                ) : quota?.message ? (
                  <div className="text-center py-5">
                    <p className="text-xs text-text-muted">{quota.message}</p>
                  </div>
                ) : (
                  <QuotaTable quotas={quota?.quotas} compact />
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {sortedConnections.length > 0 && (
        <Pagination
          currentPage={currentPageSafe}
          pageSize={DEFAULT_PAGE_SIZE}
          totalItems={sortedConnections.length}
          onPageChange={(page) => setCurrentPage(Math.max(1, Math.min(page, totalPages)))}
        />
      )}

      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => {
          setShowEditModal(false);
          setSelectedConnection(null);
        }}
      />
    </div>
  );
}
