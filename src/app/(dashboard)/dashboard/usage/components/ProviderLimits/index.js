"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { Loader2, RefreshCw, CloudOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import ProviderQuotaCard from "./ProviderQuotaCard";
import QuotaAggregateSummary from "./QuotaAggregateSummary";
import { parseQuotaData, calculatePercentage } from "./utils";
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

  /**
   * Tổng gộp đúng 2 loại: session và weekly (khớp tên quota, không cộng lẫn).
   * Cộng dồn used/total trên mọi kết nối cho từng loại.
   */
  const quotaAggregate = useMemo(() => {
    const session = { sumUsed: 0, sumTotal: 0 };
    const weekly = { sumUsed: 0, sumTotal: 0 };

    const bucket = (name) => {
      const n = String(name ?? "")
        .toLowerCase()
        .trim();
      if (n === "session") return "session";
      if (n === "weekly") return "weekly";
      return null;
    };

    const add = (target, q) => {
      if (q.total > 0) {
        target.sumUsed += q.used;
        target.sumTotal += q.total;
      }
    };

    for (const conn of sortedConnections) {
      const data = quotaData[conn.id];
      if (!data?.quotas?.length) continue;
      for (const q of data.quotas) {
        if (q.name === "error" && q.message) continue;
        const b = bucket(q.name);
        if (b === "session") add(session, q);
        else if (b === "weekly") add(weekly, q);
      }
    }

    const build = (s) => {
      if (s.sumTotal <= 0) return null;
      const remainingPct = calculatePercentage(s.sumUsed, s.sumTotal);
      const usedPct = Math.min(
        100,
        Math.max(0, Math.round((100 * s.sumUsed) / s.sumTotal)),
      );
      return {
        sumUsed: s.sumUsed,
        sumTotal: s.sumTotal,
        remainingPct,
        usedPct,
      };
    };

    const sessionAgg = build(session);
    const weeklyAgg = build(weekly);
    if (!sessionAgg && !weeklyAgg) {
      return { kind: "empty" };
    }
    return { kind: "ok", session: sessionAgg, weekly: weeklyAgg };
  }, [sortedConnections, quotaData]);

  if (connectionsLoading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-6">
        <div className="border-b border-border/50 pb-3">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-2 h-3 w-full max-w-md" />
        </div>
        <Skeleton className="h-16 w-full rounded-md" />
        <div className="flex flex-wrap justify-end gap-2">
          <Skeleton className="h-8 w-40 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[180px] rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (sortedConnections.length === 0) {
    return (
      <div className="mx-auto max-w-5xl pb-6">
        <Card className="flex flex-col items-center border-dashed py-10 text-center">
          <CloudOff
            className="mb-3 size-10 text-muted-foreground"
            aria-hidden
          />
          <h3 className="text-sm font-semibold text-foreground">
            Chưa có kết nối OAuth hỗ trợ quota
          </h3>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Thêm kết nối OAuth trong Providers để xem hạn mức tại đây.
          </p>
          <Link
            href="/dashboard/providers"
            className={cn(buttonVariants({ size: "sm" }), "mt-4")}
          >
            Providers
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-6">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-border/50 pb-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Quota
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            OAuth được hỗ trợ · tự làm mới 60s
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Cập nhật:{" "}
          <span className="font-medium text-foreground">
            {formatLastUpdated()}
          </span>
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{totalProviders}</span>{" "}
          kết nối
        </span>
        <span className="text-border">·</span>
        <span>
          <span className="font-medium text-foreground">{activeWithLimits}</span>{" "}
          có dữ liệu
        </span>
        <span className="text-border">·</span>
        <span>
          {lowQuotasCount > 0 ? (
            <Badge variant="destructive" className="px-1.5 py-0 text-xs">
              {lowQuotasCount} &lt;30%
            </Badge>
          ) : (
            <>
              <span className="font-medium text-foreground">0</span> cảnh báo
            </>
          )}
        </span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 sm:max-w-xl">
          <QuotaAggregateSummary aggregate={quotaAggregate} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-2 py-1">
            <Switch
              id="quota-auto-refresh"
              size="sm"
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
            />
            <Label
              htmlFor="quota-auto-refresh"
              className="cursor-pointer text-xs text-foreground"
            >
              Tự làm mới
            </Label>
            {autoRefresh ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                {countdown}s
              </span>
            ) : null}
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 gap-1 px-2.5 text-xs"
            onClick={refreshAll}
            disabled={refreshingAll}
          >
            {refreshingAll ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-3" aria-hidden />
            )}
            Làm mới
          </Button>
        </div>
      </div>

      <div>
        <h2 className="text-xs font-medium text-muted-foreground">
          Theo kết nối
        </h2>
        <div className="mt-1.5 grid grid-cols-1 gap-1.5 md:grid-cols-2 md:gap-2">
        {sortedConnections.map((conn) => {
          const quota = quotaData[conn.id];
          const isLoading = loading[conn.id];
          const error = errors[conn.id];

          const isInactive = conn.isActive === false;
          const rowBusy = deletingId === conn.id || togglingId === conn.id;

          return (
            <ProviderQuotaCard
              key={conn.id}
              connection={conn}
              quota={quota}
              isLoading={isLoading}
              error={error}
              isInactive={isInactive}
              rowBusy={rowBusy}
              isDeleting={deletingId === conn.id}
              onRefresh={() => refreshProvider(conn.id, conn.provider)}
              onEdit={() => {
                setSelectedConnection(conn);
                setShowEditModal(true);
              }}
              onDelete={() => handleDeleteConnection(conn.id)}
              onToggleActive={(next) =>
                handleToggleConnectionActive(conn.id, next)
              }
            />
          );
        })}
        </div>
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
