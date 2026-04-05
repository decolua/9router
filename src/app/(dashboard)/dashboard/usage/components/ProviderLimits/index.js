"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import QuotaTable from "./QuotaTable";
import Toggle from "@/shared/components/Toggle";
import { parseQuotaData, calculatePercentage } from "./utils";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import { EditConnectionModal } from "@/shared/components";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";

const REFRESH_INTERVAL_MS = 60000; // 60 seconds

export default function ProviderLimits() {
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

  const intervalRef = useRef(null);
  const countdownRef = useRef(null);

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
    if (refreshingAll) return;

    setRefreshingAll(true);
    setCountdown(60);

    try {
      const conns = await fetchConnections();

      // Filter only supported OAuth providers
      const oauthConnections = conns.filter(
        (conn) =>
          USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) &&
          conn.authType === "oauth",
      );

      // Fetch quota for supported OAuth connections only
      await Promise.all(
        oauthConnections.map((conn) => fetchQuota(conn.id, conn.provider)),
      );

      setLastUpdated(new Date());
    } catch (error) {
      console.error("Error refreshing all providers:", error);
    } finally {
      setRefreshingAll(false);
    }
  }, [refreshingAll, fetchConnections, fetchQuota]);

  // Initial load: fetch connections first so cards render immediately, then fetch quotas
  useEffect(() => {
    const initializeData = async () => {
      setConnectionsLoading(true);
      const conns = await fetchConnections();
      setConnectionsLoading(false);

      const oauthConnections = conns.filter(
        (conn) =>
          USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) &&
          conn.authType === "oauth",
      );

      // Mark all as loading before fetching
      const loadingState = {};
      oauthConnections.forEach((conn) => {
        loadingState[conn.id] = true;
      });
      setLoading(loadingState);

      await Promise.all(
        oauthConnections.map((conn) => fetchQuota(conn.id, conn.provider)),
      );
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

  // Filter only supported providers
  const filteredConnections = connections.filter(
    (conn) =>
      USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) &&
      conn.authType === "oauth",
  );

  // Sort providers by USAGE_SUPPORTED_PROVIDERS order, then alphabetically
  const sortedConnections = [...filteredConnections].sort((a, b) => {
    const orderA = USAGE_SUPPORTED_PROVIDERS.indexOf(a.provider);
    const orderB = USAGE_SUPPORTED_PROVIDERS.indexOf(b.provider);
    if (orderA !== orderB) return orderA - orderB;
    return a.provider.localeCompare(b.provider);
  });

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
  if (!connectionsLoading && sortedConnections.length === 0) {
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
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold text-text-primary">
            Provider Limits
          </h2>
          <span className="text-sm text-text-muted">
            Last updated: {formatLastUpdated()}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Auto-refresh toggle */}
          <button
            onClick={() => setAutoRefresh((prev) => !prev)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
            title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}
          >
            <span
              className={`material-symbols-outlined text-[18px] ${
                autoRefresh ? "text-primary" : "text-text-muted"
              }`}
            >
              {autoRefresh ? "toggle_on" : "toggle_off"}
            </span>
            <span className="text-sm text-text-primary">Auto-refresh</span>
            {autoRefresh && (
              <span className="text-xs text-text-muted">({countdown}s)</span>
            )}
          </button>

          {/* Refresh all button */}
          <Button
            variant="secondary"
            size="md"
            icon="refresh"
            onClick={refreshAll}
            disabled={refreshingAll}
            loading={refreshingAll}
          >
            Refresh All
          </Button>
        </div>
      </div>

      {/* Provider cards: 2 columns, compact */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sortedConnections.map((conn) => {
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
