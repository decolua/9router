"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import ProviderLimitCard from "./ProviderLimitCard";
import QuotaTable from "./QuotaTable";
import { parseQuotaData, calculatePercentage } from "./utils";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import { USAGE_SUPPORTED_PROVIDERS, QUOTA_SUPPORTED_PROVIDERS_DETAIL, AI_PROVIDERS } from "@/shared/constants/providers";

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
  const [connectionsError, setConnectionsError] = useState(null);
  /** null = show all; Set of provider names = show only those */
  const [visibleProviders, setVisibleProviders] = useState(null);

  const intervalRef = useRef(null);
  const countdownRef = useRef(null);

  // Fetch current user's provider connections (no admin required)
  const fetchConnections = useCallback(async () => {
    setConnectionsError(null);
    try {
      const response = await fetch("/api/providers/me");
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const apiMessage = body.error || body.message;
        const friendlyMessage =
          response.status === 401
            ? "Please sign in again to load your providers."
            : response.status === 403
              ? (apiMessage || "You don’t have permission to view provider connections.") + " If you need access, contact your administrator."
              : response.status >= 500
                ? "Something went wrong on our side. Please try again in a moment."
                : apiMessage || `Request failed (${response.status}). Please try again.`;
        setConnectionsError(friendlyMessage);
        setConnections([]);
        return [];
      }

      const data = await response.json();
      const connectionList = data.connections || [];
      setConnections(connectionList);
      return connectionList;
    } catch (error) {
      const isNetwork = error.name === "TypeError" && error.message.includes("fetch");
      const friendlyMessage = isNetwork
        ? "Unable to reach the server. Check your connection and try again."
        : error.message || "Something went wrong. Please try again.";
      setConnectionsError(friendlyMessage);
      setConnections([]);
      console.error("Error fetching connections:", error);
      return [];
    }
  }, []);

  // Fetch quota for a specific connection
  const fetchQuota = useCallback(async (connectionId, provider) => {
    setLoading((prev) => ({ ...prev, [connectionId]: true }));
    setErrors((prev) => ({ ...prev, [connectionId]: null }));

    try {
      console.log(`[ProviderLimits] Fetching quota for ${provider} (${connectionId})`);
      const response = await fetch(`/api/usage/${connectionId}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || response.statusText;
        
        // Handle different error types gracefully
        if (response.status === 404) {
          // Connection not found - skip silently
          console.warn(`[ProviderLimits] Connection not found for ${provider}, skipping`);
          return;
        }
        
        if (response.status === 401) {
          // Auth error - show message instead of throwing
          console.warn(`[ProviderLimits] Auth error for ${provider}:`, errorMsg);
          const contactAdminHint = " If you need access, contact your administrator.";
          setQuotaData((prev) => ({
            ...prev,
            [connectionId]: {
              quotas: [],
              message: (errorMsg || "Authentication required.") + contactAdminHint,
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
      console.error(`[ProviderLimits] Error fetching quota for ${provider} (${connectionId}):`, error);
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
    [fetchQuota]
  );

  // Refresh all providers
  const refreshAll = useCallback(async () => {
    if (refreshingAll) return;

    setRefreshingAll(true);
    setCountdown(60);

    try {
      const conns = await fetchConnections();
      
      // Filter only supported OAuth providers
      const oauthConnections = conns.filter(
        (conn) => USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) && conn.authType === "oauth"
      );
      
      // Fetch quota for supported OAuth connections only
      await Promise.all(
        oauthConnections.map((conn) => fetchQuota(conn.id, conn.provider))
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
        (conn) => USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) && conn.authType === "oauth"
      );

      // Mark all as loading before fetching
      const loadingState = {};
      oauthConnections.forEach((conn) => { loadingState[conn.id] = true; });
      setLoading(loadingState);

      await Promise.all(
        oauthConnections.map((conn) => fetchQuota(conn.id, conn.provider))
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
  const filteredConnections = connections.filter((conn) =>
    USAGE_SUPPORTED_PROVIDERS.includes(conn.provider) && conn.authType === "oauth"
  );

  // Sort providers: antigravity first, then kiro, then others alphabetically
  const sortedConnections = [...filteredConnections].sort((a, b) => {
    const getProviderPriority = (provider) => {
      if (provider === "antigravity") return 1;
      if (provider === "kiro") return 2;
      return 3;
    };

    const priorityA = getProviderPriority(a.provider);
    const priorityB = getProviderPriority(b.provider);

    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }

    // Same priority: sort alphabetically
    return a.provider.localeCompare(b.provider);
  });

  // Filter by user-selected providers (visibleProviders null = show all)
  const displayConnections =
    visibleProviders === null
      ? sortedConnections
      : sortedConnections.filter((c) => visibleProviders.has(c.provider));

  const uniqueProviderNames = [...new Set(sortedConnections.map((c) => c.provider))];

  const toggleProviderFilter = useCallback((provider) => {
    if (provider === null) {
      setVisibleProviders(null);
      return;
    }
    setVisibleProviders((prev) => {
      const next = new Set(prev === null ? [] : prev);
      if (next.has(provider)) {
        next.delete(provider);
        return next.size === 0 ? null : next;
      }
      next.add(provider);
      return next;
    });
  }, []);

  // Sync visibleProviders when sortedConnections change (e.g. after fetch) so Set stays valid
  useEffect(() => {
    if (visibleProviders !== null && visibleProviders.size > 0) {
      setVisibleProviders((prev) => {
        const valid = new Set(sortedConnections.map((c) => c.provider));
        const next = new Set([...prev].filter((p) => valid.has(p)));
        return next.size === 0 ? null : next;
      });
    }
  }, [sortedConnections.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Calculate summary stats (from displayed set)
  const totalProviders = displayConnections.length;
  const activeWithLimits = Object.values(quotaData).filter(
    (data) => data?.quotas?.length > 0
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

  // Error state (fetch failed)
  if (connectionsError) {
    return (
      <div className="space-y-6">
        <Card padding="lg">
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-[64px] text-amber-500 dark:text-amber-400 opacity-80">
              error_outline
            </span>
            <h3 className="mt-4 text-lg font-semibold text-text-primary">
              Couldn’t load providers
            </h3>
            <p className="mt-2 text-sm text-text-muted max-w-md mx-auto">
              {connectionsError}
            </p>
            <Button
              variant="primary"
              size="md"
              icon="refresh"
              className="mt-6"
              onClick={() => {
                setConnectionsLoading(true);
                fetchConnections().finally(() => setConnectionsLoading(false));
              }}
              disabled={connectionsLoading}
              loading={connectionsLoading}
            >
              Try again
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Empty state (no connections)
  if (!connectionsLoading && sortedConnections.length === 0) {
    return (
      <div className="space-y-6">
        <Card padding="lg">
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-[64px] text-text-muted opacity-20">
              cloud_off
            </span>
            <h3 className="mt-4 text-lg font-semibold text-text-primary">
              No Providers Connected
            </h3>
            <p className="mt-2 text-sm text-text-muted max-w-md mx-auto">
              Connect to providers with OAuth (in CLI tools or profile) to track your API quota limits and usage.
            </p>
          </div>
        </Card>
        <Card padding="lg">
          <h3 className="text-sm font-semibold text-text-primary mb-2">Providers that support quota tracking</h3>
          <p className="text-sm text-text-muted mb-4">
            These providers expose usage/limits when connected via OAuth:
          </p>
          <ul className="space-y-3">
            {QUOTA_SUPPORTED_PROVIDERS_DETAIL.map((p) => {
              const meta = AI_PROVIDERS[p.id];
              const iconName = meta?.icon || "code";
              return (
                <li key={p.id} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="material-symbols-outlined text-[20px] text-text-muted shrink-0"
                      style={meta?.color ? { color: meta.color } : undefined}
                      aria-hidden
                    >
                      {iconName}
                    </span>
                    <span className="text-sm font-medium text-text-primary capitalize">{p.name}</span>
                    <span className="text-xs text-text-muted">— {p.quotaTypes.join(", ")}</span>
                  </div>
                  <p className="text-xs text-text-muted pl-7">{p.description}</p>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
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

      {/* Provider filter: choose which providers to show */}
      {uniqueProviderNames.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-text-muted mr-1">Show:</span>
          <button
            type="button"
            onClick={() => toggleProviderFilter(null)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              visibleProviders === null
                ? "bg-primary text-white"
                : "bg-bg-subtle text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
            }`}
          >
            All
          </button>
          {uniqueProviderNames.map((name) => {
            const isActive = visibleProviders === null || visibleProviders.has(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggleProviderFilter(name)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${
                  isActive
                    ? "bg-primary/15 text-primary dark:bg-primary/20"
                    : "bg-bg-subtle text-text-muted hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}

      {/* Supported providers detail */}
      <Card padding="lg">
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-primary text-[24px] shrink-0" aria-hidden>
            info
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text-primary mb-1">Providers that support quota tracking</h3>
            <p className="text-sm text-text-muted mb-4">
              Connect via OAuth in CLI tools or profile to see limits and usage below. Each provider exposes different quota types.
            </p>
            <ul className="space-y-3">
              {QUOTA_SUPPORTED_PROVIDERS_DETAIL.map((p) => {
                const meta = AI_PROVIDERS[p.id];
                const iconName = meta?.icon || "code";
                return (
                  <li key={p.id} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="material-symbols-outlined text-[20px] text-text-muted shrink-0"
                        style={meta?.color ? { color: meta.color } : undefined}
                        aria-hidden
                      >
                        {iconName}
                      </span>
                      <span className="text-sm font-medium text-text-primary capitalize">{p.name}</span>
                      <span className="text-xs text-text-muted">— {p.quotaTypes.join(", ")}</span>
                    </div>
                    <p className="text-xs text-text-muted pl-7">{p.description}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </Card>

      {/* Provider Cards Grid */}
      <div className="flex flex-col gap-4">
        {displayConnections.map((conn) => {
          const quota = quotaData[conn.id];
          const isLoading = loading[conn.id];
          const error = errors[conn.id];

          // Use table layout for all providers
          return (
            <Card key={conn.id} padding="none">
              <div className="p-6 border-b border-black/10 dark:border-white/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden">
                      <Image
                        src={`/providers/${conn.provider}.png`}
                        alt={conn.provider}
                        width={40}
                        height={40}
                        className="object-contain"
                        sizes="40px"
                      />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-text-primary capitalize">
                        {conn.provider}
                      </h3>
                      {conn.name && (
                        <p className="text-sm text-text-muted">{conn.name}</p>
                      )}
                    </div>
                  </div>
                  
                  <button
                    onClick={() => refreshProvider(conn.id, conn.provider)}
                    disabled={isLoading}
                    className="p-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
                    title="Refresh quota"
                  >
                    <span className={`material-symbols-outlined text-[20px] text-text-muted ${isLoading ? "animate-spin" : ""}`}>
                      refresh
                    </span>
                  </button>
                </div>
              </div>

              <div className="p-6">
                {isLoading ? (
                  <div className="text-center py-8 text-text-muted">
                    <span className="material-symbols-outlined text-[32px] animate-spin">
                      progress_activity
                    </span>
                  </div>
                ) : error ? (
                  <div className="text-center py-8">
                    <span className="material-symbols-outlined text-[32px] text-red-500">
                      error
                    </span>
                    <p className="mt-2 text-sm text-text-muted">{error}</p>
                  </div>
                ) : quota?.message ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-text-muted">{quota.message}</p>
                  </div>
                ) : quota?.quotas?.length > 0 ? (
                  <QuotaTable quotas={quota.quotas} />
                ) : (
                  <div className="text-center py-8 text-text-muted">
                    <span className="material-symbols-outlined text-[32px] opacity-50 block mb-2">pie_chart</span>
                    <p className="text-sm">No quota data available</p>
                    <p className="text-xs mt-1 opacity-80">Provider may not expose usage API or limits.</p>
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
