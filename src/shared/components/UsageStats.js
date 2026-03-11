"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Badge from "./Badge";
import Card from "./Card";
import { CardSkeleton } from "./Loading";
import TimeRangeModal from "./TimeRangeModal";
import OverviewCards from "@/app/(dashboard)/dashboard/usage/components/OverviewCards";
import UsageTable, { fmt, fmtTime } from "@/app/(dashboard)/dashboard/usage/components/UsageTable";
import ProviderTopology from "@/app/(dashboard)/dashboard/usage/components/ProviderTopology";
import UsageChart from "@/app/(dashboard)/dashboard/usage/components/UsageChart";

function timeAgo(timestamp) {
  const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Auto-update time display every second without re-rendering parent
function TimeAgo({ timestamp }) {
  const [, setTick] = useState(0);
  
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  
  return <>{timeAgo(timestamp)}</>;
}

function RecentRequests({ requests = [] }) {
  return (
    <Card className="flex flex-col overflow-hidden" padding="sm" style={{ height: 480 }}>
      {/* Header */}
      <div className="px-1 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Recent Requests</span>
      </div>

      {!requests.length ? (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">No requests yet.</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-bg z-10">
              <tr className="border-b border-border">
                <th className="py-1.5 text-left font-semibold text-text-muted w-2"></th>
                <th className="py-1.5 text-left font-semibold text-text-muted">Model</th>
                <th className="py-1.5 text-right font-semibold text-text-muted whitespace-nowrap">In / Out</th>
                <th className="py-1.5 text-right font-semibold text-text-muted">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {requests.map((r, i) => {
                const ok = !r.status || r.status === "ok" || r.status === "success";
                return (
                  <tr key={i} className="hover:bg-bg-subtle transition-colors">
                    <td className="py-1.5">
                      <span className={`block w-1.5 h-1.5 rounded-full ${ok ? "bg-success" : "bg-error"}`} />
                    </td>
                    <td className="py-1.5 font-mono truncate max-w-[120px]" title={r.model}>{r.model}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <span className="text-primary">{fmt(r.promptTokens)}↑</span>
                      {" "}
                      <span className="text-success">{fmt(r.completionTokens)}↓</span>
                    </td>
                    <td className="py-1.5 text-right text-text-muted whitespace-nowrap"><TimeAgo timestamp={r.timestamp} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function sortData(dataMap, pendingMap = {}, sortBy, sortOrder) {
  return Object.entries(dataMap || {})
    .map(([key, data]) => {
      const totalTokens = (data.promptTokens || 0) + (data.completionTokens || 0);
      const totalCost = data.cost || 0;
      const inputCost = totalTokens > 0 ? (data.promptTokens || 0) * (totalCost / totalTokens) : 0;
      const outputCost = totalTokens > 0 ? (data.completionTokens || 0) * (totalCost / totalTokens) : 0;
      return { ...data, key, totalTokens, totalCost, inputCost, outputCost, pending: pendingMap[key] || 0 };
    })
    .sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (valA < valB) return sortOrder === "asc" ? -1 : 1;
      if (valA > valB) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
}

function getGroupKey(item, keyField) {
  switch (keyField) {
    case "rawModel": return item.rawModel || "Unknown Model";
    case "accountName": return item.accountName || `Account ${item.connectionId?.slice(0, 8)}...` || "Unknown Account";
    case "keyName": return item.keyName || "Unknown Key";
    case "endpoint": return item.endpoint || "Unknown Endpoint";
    default: return item[keyField] || "Unknown";
  }
}

function groupDataByKey(data, keyField) {
  if (!Array.isArray(data)) return [];
  const groups = {};
  data.forEach((item) => {
    const gk = getGroupKey(item, keyField);
    if (!groups[gk]) {
      groups[gk] = {
        groupKey: gk,
        summary: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0, inputCost: 0, outputCost: 0, lastUsed: null, pending: 0 },
        items: [],
      };
    }
    const s = groups[gk].summary;
    s.requests += item.requests || 0;
    s.promptTokens += item.promptTokens || 0;
    s.completionTokens += item.completionTokens || 0;
    s.totalTokens += item.totalTokens || 0;
    s.cost += item.cost || 0;
    s.inputCost += item.inputCost || 0;
    s.outputCost += item.outputCost || 0;
    s.pending += item.pending || 0;
    if (item.lastUsed && (!s.lastUsed || new Date(item.lastUsed) > new Date(s.lastUsed))) {
      s.lastUsed = item.lastUsed;
    }
    groups[gk].items.push(item);
  });
  return Object.values(groups);
}

const MODEL_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const ACCOUNT_COLUMNS = [
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "accountName", label: "Account" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const API_KEY_COLUMNS = [
  { field: "keyName", label: "API Key Name" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const ENDPOINT_COLUMNS = [
  { field: "endpoint", label: "Endpoint" },
  { field: "rawModel", label: "Model" },
  { field: "provider", label: "Provider" },
  { field: "requests", label: "Requests", align: "right" },
  { field: "lastUsed", label: "Last Used", align: "right" },
];

const TABLE_OPTIONS = [
  { value: "model", label: "Usage by Model" },
  { value: "account", label: "Usage by Account" },
  { value: "apiKey", label: "Usage by API Key" },
  { value: "endpoint", label: "Usage by Endpoint" },
];

const PERIODS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

export default function UsageStats() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const modelSortBy = searchParams.get("modelSortBy") || "rawModel";
  const modelSortOrder = searchParams.get("modelSortOrder") || "asc";
  const accountSortBy = searchParams.get("accountSortBy") || "rawModel";
  const accountSortOrder = searchParams.get("accountSortOrder") || "asc";
  const apiKeySortBy = searchParams.get("apiKeySortBy") || "keyName";
  const apiKeySortOrder = searchParams.get("apiKeySortOrder") || "asc";
  const timeRangeParam = searchParams.get("timeRange") || "all";

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [viewMode, setViewMode] = useState("tokens"); // 'tokens' or 'costs'
  const [timeRange, setTimeRange] = useState(timeRangeParam);
  const [refreshInterval, setRefreshInterval] = useState(5000); // Start with 5s
  const [prevTotalRequests, setPrevTotalRequests] = useState(0);
  const [expandedModels, setExpandedModels] = useState(new Set());
  const [expandedAccounts, setExpandedAccounts] = useState(new Set());
  const [expandedApiKeys, setExpandedApiKeys] = useState(new Set());
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showTimeRangeModal, setShowTimeRangeModal] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(0);

  // Fetch connected providers once, deduplicate by provider type
  useEffect(() => {
    fetch("/api/providers")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d?.connections) return;
        const seen = new Set();
        const unique = d.connections.filter((c) => {
          if (seen.has(c.provider)) return false;
          seen.add(c.provider);
          return true;
        });
        setProviders(unique);
      })
      .catch(() => {});
  }, []);

  // Fetch filtered stats via REST when period changes
  useEffect(() => {
    // First load: show full spinner; subsequent: show subtle fetching indicator
    if (!stats) setLoading(true);
    else setFetching(true);

    fetch(`/api/usage/stats?period=${period}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) setStats((prev) => ({ ...prev, ...data }));
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setFetching(false);
      });
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  // SSE connection - real-time updates for activeRequests + recentRequests only
  useEffect(() => {
    const es = new EventSource("/api/usage/stream");

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        // Only update real-time fields from SSE, keep filtered stats intact
        setStats((prev) => prev ? {
          ...prev,
          activeRequests: data.activeRequests,
          recentRequests: data.recentRequests,
          errorProvider: data.errorProvider,
          pending: data.pending,
        } : data);
        setLoading(false);
      } catch (err) {
        console.error("[SSE CLIENT] parse error:", err);
      }
    };

    es.onerror = () => setLoading(false);

    return () => es.close();
  }, []);

  const toggleSort = useCallback((tableType, field) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("sortBy") === field) {
      params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
    } else {
      params.set("sortBy", field);
      params.set("sortOrder", "asc");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // Compute active table data
  const activeTableConfig = useMemo(() => {
    if (!stats) return null;
    switch (tableView) {
      case "model": {
        const pendingMap = stats.pending?.byModel || {};
        return {
          columns: MODEL_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byModel, pendingMap, sortBy, sortOrder), "rawModel"),
          storageKey: "usage-stats:expanded-models",
          emptyMessage: "No usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.rawModel}</td>
              <td className="px-6 py-3"><Badge variant={item.pending > 0 ? "primary" : "neutral"} size="sm">{item.provider}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "account": {
        const pendingMap = {};
        if (stats?.pending?.byAccount) {
          Object.entries(stats.byAccount || {}).forEach(([accountKey, data]) => {
            const connPending = stats.pending.byAccount[data.connectionId];
            if (connPending) {
              const modelKey = data.provider ? `${data.rawModel} (${data.provider})` : data.rawModel;
              pendingMap[accountKey] = connPending[modelKey] || 0;
            }
          });
        }
        return {
          columns: ACCOUNT_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byAccount, pendingMap, sortBy, sortOrder), "accountName"),
          storageKey: "usage-stats:expanded-accounts",
          emptyMessage: "No account-specific usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.accountName || `Account ${item.connectionId?.slice(0, 8)}...`}</td>
              <td className={`px-6 py-3 font-medium transition-colors ${item.pending > 0 ? "text-primary" : ""}`}>{item.rawModel}</td>
              <td className="px-6 py-3"><Badge variant={item.pending > 0 ? "primary" : "neutral"} size="sm">{item.provider}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "apiKey": {
        return {
          columns: API_KEY_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byApiKey, {}, sortBy, sortOrder), "keyName"),
          storageKey: "usage-stats:expanded-apikeys",
          emptyMessage: "No API key usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="px-6 py-3 font-medium">{item.keyName}</td>
              <td className="px-6 py-3">{item.rawModel}</td>
              <td className="px-6 py-3"><Badge variant="neutral" size="sm">{item.provider}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
      case "endpoint":
      default: {
        return {
          columns: ENDPOINT_COLUMNS,
          groupedData: groupDataByKey(sortData(stats.byEndpoint, {}, sortBy, sortOrder), "endpoint"),
          storageKey: "usage-stats:expanded-endpoints",
          emptyMessage: "No endpoint usage recorded yet.",
          renderSummaryCells: (group) => (
            <>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-text-muted">—</td>
              <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(group.summary.lastUsed)}</td>
            </>
          ),
          renderDetailCells: (item) => (
            <>
              <td className="px-6 py-3 font-medium font-mono text-sm">{item.endpoint}</td>
              <td className="px-6 py-3">{item.rawModel}</td>
              <td className="px-6 py-3"><Badge variant="neutral" size="sm">{item.provider}</Badge></td>
              <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
              <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">{fmtTime(item.lastUsed)}</td>
            </>
          ),
        };
      }
    }
  }, [stats, tableView, sortBy, sortOrder]);

  if (!stats && !loading) return <div className="text-text-muted">Failed to load usage statistics.</div>;

  const spinner = (
    <div className="flex items-center justify-center py-12 text-text-muted">
      <span className="material-symbols-outlined text-[32px] animate-spin">progress_activity</span>
    </div>
  );

  const groupedModels = useMemo(
    () => groupDataByKey(sortedModels, 'rawModel'),
    [sortedModels, groupDataByKey]
  );
  const sortedAccounts = useMemo(() => {
    const accountPendingMap = {};
    if (stats?.pending?.byAccount) {
      Object.entries(stats.byAccount || {}).forEach(([accountKey, data]) => {
        const connPending = stats.pending.byAccount[data.connectionId];
        if (connPending) {
          const modelKey = data.provider
            ? `${data.rawModel} (${data.provider})`
            : data.rawModel;
          accountPendingMap[accountKey] = connPending[modelKey] || 0;
        }
      });
    }
    return sortData(stats?.byAccount, accountPendingMap, accountSortBy, accountSortOrder);
  }, [stats?.byAccount, stats?.pending?.byAccount, accountSortBy, accountSortOrder, sortData]);

  const groupedAccounts = useMemo(
    () => groupDataByKey(sortedAccounts, 'accountName'),
    [sortedAccounts, groupDataByKey]
  );

  const sortedApiKeys = useMemo(() => sortData(stats?.byApiKey, {}, apiKeySortBy, apiKeySortOrder), [stats?.byApiKey, apiKeySortBy, apiKeySortOrder, sortData]);

  const groupedApiKeys = useMemo(
    () => groupDataByKey(sortedApiKeys, 'keyName'),
    [sortedApiKeys, groupDataByKey]
  );

  const fetchStats = useCallback(async (showLoading = true) => {
    // Save scroll position before fetching (only if not showing loading skeleton)
    if (!showLoading && window.scrollY > 0) {
      setScrollPosition(window.scrollY);
    }

    if (showLoading) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (timeRange && timeRange !== "all") {
        if (typeof timeRange === "object" && timeRange.type === "custom") {
          // Custom date range
          params.set("startDate", timeRange.startDate);
          params.set("endDate", timeRange.endDate);
        } else {
          // Predefined range
          params.set("range", timeRange);
        }
      }
      const url = `/api/usage/history${params.toString() ? `?${params.toString()}` : ""}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setStats(data);

        // Smart polling: adjust interval based on activity
        const currentTotal = data.totalRequests || 0;
        if (currentTotal > prevTotalRequests) {
          // New requests detected - reset to fast polling
          setRefreshInterval(5000);
        } else {
          // No change - increase interval (exponential backoff)
          setRefreshInterval((prev) => Math.min(prev * 2, 60000)); // Max 60s
        }
        setPrevTotalRequests(currentTotal);
      }
    } catch (error) {
      console.error("Failed to fetch usage stats:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [prevTotalRequests, timeRange]);

  const handleClearMetrics = async () => {
    setClearing(true);
    try {
      const res = await fetch("/api/usage/clear", {
        method: "POST"
      });

      if (res.ok) {
        // Clear local state
        setStats({
          totalRequests: 0,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          totalCost: 0,
          byProvider: {},
          byModel: {},
          byAccount: {},
          byApiKey: {},
          last10Minutes: [],
          pending: { byModel: {}, byAccount: {} },
          activeRequests: []
        });
        setPrevTotalRequests(0);
        setShowClearConfirm(false);
        // Refresh stats to get fresh data
        await fetchStats(false);
      } else {
        console.error("Failed to clear metrics");
      }
    } catch (error) {
      console.error("Error clearing metrics:", error);
    } finally {
      setClearing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Restore scroll position after stats update
  useEffect(() => {
    if (scrollPosition > 0 && !loading) {
      window.scrollTo({ top: scrollPosition, behavior: 'instant' });
      setScrollPosition(0);
    }
  }, [stats, scrollPosition, loading]);

  // Sync timeRange state with URL parameter
  useEffect(() => {
    try {
      // Try to parse as JSON (custom range)
      const parsed = JSON.parse(timeRangeParam);
      if (parsed && parsed.type === "custom") {
        setTimeRange(parsed);
        return;
      }
    } catch (e) {
      // Not JSON, treat as regular string
    }
    setTimeRange(timeRangeParam);
  }, [timeRangeParam]);

  // Update URL when timeRange changes
  const handleTimeRangeChange = useCallback((newRange) => {
    const params = new URLSearchParams(searchParams.toString());
    if (typeof newRange === "object" && newRange.type === "custom") {
      // Store custom range as JSON string in URL
      params.set("timeRange", JSON.stringify(newRange));
    } else {
      params.set("timeRange", newRange);
    }
    router.replace(`?${params.toString()}`, { scroll: false });
    setTimeRange(newRange);
  }, [searchParams, router]);

  // Get label for current time range
  const getTimeRangeLabel = useCallback(() => {
    if (typeof timeRange === "object" && timeRange.type === "custom") {
      return "Custom";
    }
    if (timeRange === "all") {
      return "All Time";
    }
    return `Last ${timeRange}`;
  }, [timeRange]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('usage-stats:expanded-models');
      if (saved) {
        setExpandedModels(new Set(JSON.parse(saved)));
      }
    } catch (error) {
      console.error("Failed to load expanded models from localStorage:", error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('usage-stats:expanded-models', JSON.stringify([...expandedModels]));
    } catch (error) {
      console.error("Failed to save expanded models to localStorage:", error);
    }
  }, [expandedModels]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('usage-stats:expanded-accounts');
      if (saved) {
        setExpandedAccounts(new Set(JSON.parse(saved)));
      }
    } catch (error) {
      console.error("Failed to load expanded accounts from localStorage:", error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('usage-stats:expanded-accounts', JSON.stringify([...expandedAccounts]));
    } catch (error) {
      console.error("Failed to save expanded accounts to localStorage:", error);
    }
  }, [expandedAccounts]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('usage-stats:expanded-apikeys');
      if (saved) {
        setExpandedApiKeys(new Set(JSON.parse(saved)));
      }
    } catch (error) {
      console.error("Failed to load expanded API keys from localStorage:", error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('usage-stats:expanded-apikeys', JSON.stringify([...expandedApiKeys]));
    } catch (error) {
      console.error("Failed to save expanded API keys to localStorage:", error);
    }
  }, [expandedApiKeys]);

  const toggleModelGroup = useCallback((groupKey) => {
    setExpandedModels(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const toggleAccountGroup = useCallback((groupKey) => {
    setExpandedAccounts(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const toggleApiKeyGroup = useCallback((groupKey) => {
    setExpandedApiKeys(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let intervalId;
    let isPageVisible = true;

    // Page Visibility API - pause when tab is hidden
    const handleVisibilityChange = () => {
      isPageVisible = !document.hidden;
      if (isPageVisible && autoRefresh) {
        fetchStats(false); // Fetch immediately when tab becomes visible
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (autoRefresh) {
      // Clear any existing interval first
      if (intervalId) clearInterval(intervalId);
      
      intervalId = setInterval(() => {
        if (isPageVisible) {
          fetchStats(false); // fetch without loading skeleton
        }
      }, refreshInterval);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [autoRefresh, refreshInterval, fetchStats]);

  if (loading) return <CardSkeleton />;

  if (!stats)
    return (
      <div className="text-text-muted">Failed to load usage statistics.</div>
    );

  // Format number with commas
  const fmt = (n) => new Intl.NumberFormat().format(n || 0);

  // Format cost with dollar sign and 2 decimals
  const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

  // Time format for "Last Used"
  const fmtTime = (iso) => {
    if (!iso) return "Never";
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header with Time Range Filter, Auto Refresh Toggle and View Toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Usage Overview</h2>
        <div className="flex items-center gap-2">
          {/* Time Range Filter - Compact Button */}
          <button
            onClick={() => setShowTimeRangeModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors bg-bg-subtle hover:bg-bg-hover border border-border"
          >
            <span className="material-symbols-outlined text-[18px]">calendar_month</span>
            <span>{getTimeRangeLabel()}</span>
            <span className="material-symbols-outlined text-[16px]">expand_more</span>
          </button>

          {/* View Toggle */}
          <div className="flex items-center gap-1 bg-bg-subtle rounded-lg p-1 border border-border">
            <button
              onClick={() => setViewMode("costs")}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                viewMode === "costs"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-muted hover:text-text hover:bg-bg-hover"
              }`}
            >
              Costs
            </button>
          </div>

          {/* Clear Metrics Button */}
          <button
            onClick={() => setShowClearConfirm(true)}
            disabled={!stats || stats.totalRequests === 0}
            className="px-3 py-1 rounded-md text-sm font-medium transition-colors bg-red-500/10 text-red-600 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed border border-red-500/20"
          >
            Clear Metrics
          </button>

          {/* Auto Refresh Toggle */}
          <div className="text-sm font-medium text-text-muted flex items-center gap-2">
            <span>Auto Refresh ({refreshInterval / 1000}s)</span>
            <button
              type="button"
              onClick={() => setAutoRefresh(!autoRefresh)}
              role="switch"
              aria-checked={autoRefresh}
              aria-label="Toggle auto refresh"
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                autoRefresh ? "bg-primary" : "bg-bg-subtle border border-border"
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  autoRefresh ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>
        {fetching && (
          <span className="material-symbols-outlined text-[16px] text-text-muted animate-spin">progress_activity</span>
        )}
      </div>

      {/* Time Range Modal */}
      <TimeRangeModal
        isOpen={showTimeRangeModal}
        onClose={() => setShowTimeRangeModal(false)}
        currentRange={timeRange}
        onRangeChange={handleTimeRangeChange}
      />

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg border border-border rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-2">Clear All Usage Metrics?</h3>
            <p className="text-text-muted mb-4">
              This will permanently delete all usage history, including request counts, token usage, and cost data. This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowClearConfirm(false)}
                disabled={clearing}
                className="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-bg-subtle hover:bg-bg-hover border border-border disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleClearMetrics}
                disabled={clearing}
                className="px-4 py-2 rounded-md text-sm font-medium transition-colors bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {clearing ? (
                  <>
                    <span className="inline-block h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Clearing...
                  </>
                ) : (
                  "Clear All Data"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Requests Summary */}
      {(stats.activeRequests || []).length > 0 && (
        <Card className="p-3 border-primary/20 bg-primary/5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-primary font-semibold text-sm uppercase tracking-wider">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
              </span>
              Active Requests
            </div>
            <div className="flex flex-wrap gap-3">
              {stats.activeRequests.map((req) => (
                <div
                  key={`${req.model}-${req.provider}-${req.account}`}
                  className="px-3 py-1.5 rounded-md bg-bg-subtle border border-primary/20 text-xs font-mono shadow-sm"
                >
                  <span className="text-primary font-bold">{req.model}</span>
                  <span className="mx-1 text-text-muted">|</span>
                  <span className="text-text">{req.provider}</span>
                  <span className="mx-1 text-text-muted">|</span>
                  <span className="text-text font-medium">{req.account}</span>
                  {req.count > 1 && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-primary text-white font-bold">
                      x{req.count}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Token / Cost chart - sync period */}
      {loading ? spinner : <UsageChart period={period} />}

      {/* Table with dropdown selector */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <select
            value={tableView}
            onChange={(e) => setTableView(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-bg-subtle text-sm font-medium text-text focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {TABLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {loading ? spinner : activeTableConfig && (
          <UsageTable
            title=""
            columns={activeTableConfig.columns}
            groupedData={activeTableConfig.groupedData}
            tableType={tableView}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onToggleSort={toggleSort}
            storageKey={activeTableConfig.storageKey}
            renderSummaryCells={activeTableConfig.renderSummaryCells}
            renderDetailCells={activeTableConfig.renderDetailCells}
            emptyMessage={activeTableConfig.emptyMessage}
          />
        )}
      </div>
    </div>
  );
}
