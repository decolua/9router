"use client";

import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import PropTypes from "prop-types";
import { useSearchParams, useRouter } from "next/navigation";
import Card from "./Card";
import Badge from "./Badge";
import { CardSkeleton } from "./Loading";

function SortIcon({ field, currentSort, currentOrder }) {
  if (currentSort !== field) return <span className="ml-1 opacity-20">↕</span>;
  return <span className="ml-1">{currentOrder === "asc" ? "↑" : "↓"}</span>;
}

SortIcon.propTypes = {
  field: PropTypes.string.isRequired,
  currentSort: PropTypes.string.isRequired,
  currentOrder: PropTypes.string.isRequired,
};

function MiniBarGraph({ data, colorClass = "bg-primary" }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-1 h-8 w-24">
      {data.slice(-9).map((val, idx) => (
        <div
          key={`bar-${idx}-${val}`}
          className={`flex-1 rounded-t-sm transition-all duration-500 ${colorClass}`}
          style={{ height: `${Math.max((val / max) * 100, 5)}%` }}
          title={String(val)}
        />
      ))}
    </div>
  );
}

MiniBarGraph.propTypes = {
  data: PropTypes.arrayOf(PropTypes.number).isRequired,
  colorClass: PropTypes.string,
};

export default function UsageStats() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const modelSortBy = searchParams.get("modelSortBy") || "rawModel";
  const modelSortOrder = searchParams.get("modelSortOrder") || "asc";
  const accountSortBy = searchParams.get("accountSortBy") || "rawModel";
  const accountSortOrder = searchParams.get("accountSortOrder") || "asc";
  const apiKeySortBy = searchParams.get("apiKeySortBy") || "keyName";
  const apiKeySortOrder = searchParams.get("apiKeySortOrder") || "asc";

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [viewMode, setViewMode] = useState("tokens"); // 'tokens' or 'costs'
  const [refreshInterval, setRefreshInterval] = useState(5000); // Start with 5s
  const [prevTotalRequests, setPrevTotalRequests] = useState(0);
  const [expandedModels, setExpandedModels] = useState(new Set());
  const [expandedAccounts, setExpandedAccounts] = useState(new Set());
  const [expandedApiKeys, setExpandedApiKeys] = useState(new Set());

  const toggleSort = (tableType, field) => {
    const sortKeyMap = {
      model: { by: "modelSortBy", order: "modelSortOrder" },
      account: { by: "accountSortBy", order: "accountSortOrder" },
      apiKey: { by: "apiKeySortBy", order: "apiKeySortOrder" }
    };
    const sortKeys = sortKeyMap[tableType];
    const params = new URLSearchParams(searchParams.toString());
    
    const currentBy = params.get(sortKeys.by);
    const currentOrder = params.get(sortKeys.order);
    
    if (currentBy === field) {
      params.set(sortKeys.order, currentOrder === "asc" ? "desc" : "asc");
    } else {
      params.set(sortKeys.by, field);
      params.set(sortKeys.order, "asc");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const sortData = useCallback((dataMap, pendingMap = {}, sortBy, sortOrder) => {
    return Object.entries(dataMap || {})
      .map(([key, data]) => {
        const totalTokens =
          (data.promptTokens || 0) + (data.completionTokens || 0);
        const totalCost = data.cost || 0;

        const inputCost =
          totalTokens > 0
            ? (data.promptTokens || 0) * (totalCost / totalTokens)
            : 0;
        const outputCost =
          totalTokens > 0
            ? (data.completionTokens || 0) * (totalCost / totalTokens)
            : 0;

        return {
          ...data,
          key,
          totalTokens,
          totalCost,
          inputCost,
          outputCost,
          pending: pendingMap[key] || 0,
        };
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
  }, []);

  /**
   * Extract grouping key from data item based on field type
   * @param {object} item - Data item with usage stats
   * @param {string} keyField - Field to use for grouping ('rawModel', 'accountName', 'keyName')
   * @returns {string} - Grouping key value
   */
  const getGroupKey = useCallback((item, keyField) => {
    switch (keyField) {
      case 'rawModel':
        return item.rawModel || 'Unknown Model';
      case 'accountName':
        return item.accountName || `Account ${item.connectionId?.slice(0, 8)}...` || 'Unknown Account';
      case 'keyName':
        return item.keyName || 'Unknown Key';
      default:
        return item[keyField] || 'Unknown';
    }
  }, []);

  /**
   * Group flat data array by key field and calculate aggregated values
   * @param {Array} data - Flat array of data items (output from sortData)
   * @param {string} keyField - Field to use for grouping ('rawModel', 'accountName', 'keyName')
   * @returns {Array} - Array of groups with summary and items
   */
   const groupDataByKey = useCallback((data, keyField) => {
    if (!Array.isArray(data)) return [];

    const groups = {};

    data.forEach((item) => {
      const groupKey = getGroupKey(item, keyField);

      if (!groups[groupKey]) {
        groups[groupKey] = {
          groupKey,
          summary: {
            requests: 0,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            cost: 0,
            inputCost: 0,
            outputCost: 0,
            lastUsed: null,
            pending: 0
          },
          items: []
        };
      }

      const group = groups[groupKey];

      // Aggregate values: sum for most, max for lastUsed
      group.summary.requests += item.requests || 0;
      group.summary.promptTokens += item.promptTokens || 0;
      group.summary.completionTokens += item.completionTokens || 0;
      group.summary.totalTokens += item.totalTokens || 0;
      group.summary.cost += item.cost || 0;
      group.summary.inputCost += item.inputCost || 0;
      group.summary.outputCost += item.outputCost || 0;
      group.summary.pending += item.pending || 0;

      // Take max for lastUsed (most recent timestamp)
      if (item.lastUsed) {
        if (!group.summary.lastUsed || new Date(item.lastUsed) > new Date(group.summary.lastUsed)) {
          group.summary.lastUsed = item.lastUsed;
        }
      }

      // Add item to group
      group.items.push(item);
    });

    return Object.values(groups);
  }, [getGroupKey]);

  const sortedModels = useMemo(
    () => sortData(stats?.byModel, stats?.pending?.byModel, modelSortBy, modelSortOrder),
    [stats?.byModel, stats?.pending?.byModel, modelSortBy, modelSortOrder, sortData]
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
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/usage/history");
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
  }, [prevTotalRequests]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

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
      {/* Header with Auto Refresh Toggle and View Toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Usage Overview</h2>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex items-center gap-1 bg-bg-subtle rounded-lg p-1 border border-border">
            <button
              onClick={() => setViewMode("tokens")}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                viewMode === "tokens"
                  ? "bg-primary text-white shadow-sm"
                  : "text-text-muted hover:text-text hover:bg-bg-hover"
              }`}
            >
              Tokens
            </button>
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
      </div>

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

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="px-4 py-3 flex flex-col gap-1">
          <div className="flex justify-between items-start">
            <div className="flex flex-col gap-1">
              <span className="text-text-muted text-sm uppercase font-semibold">
                Total Requests
              </span>
              <span className="text-2xl font-bold">
                {fmt(stats.totalRequests)}
              </span>
            </div>
            <MiniBarGraph
              data={(stats.last10Minutes || []).map((m) => m.requests)}
              colorClass="bg-text-muted/30"
            />
          </div>
        </Card>
        <Card className="px-4 py-3 flex flex-col gap-1">
          <div className="flex justify-between items-start">
            <div className="flex flex-col gap-1">
              <span className="text-text-muted text-sm uppercase font-semibold">
                Total Input Tokens
              </span>
              <span className="text-2xl font-bold text-primary">
                {fmt(stats.totalPromptTokens)}
              </span>
            </div>
            <MiniBarGraph
              data={(stats.last10Minutes || []).map((m) => m.promptTokens)}
              colorClass="bg-primary/50"
            />
          </div>
        </Card>
        <Card className="px-4 py-2 flex flex-col gap-1">
          <div className="flex justify-between items-start gap-4">
            <div className="flex flex-col gap-1 flex-1">
              <span className="text-text-muted text-sm uppercase font-semibold">
                Output Tokens
              </span>
              <span className="text-2xl font-bold text-success">
                {fmt(stats.totalCompletionTokens)}
              </span>
            </div>
            <div className="w-px bg-border self-stretch mx-2" />
            <div className="flex flex-col gap-1 flex-1">
              <span className="text-text-muted text-sm uppercase font-semibold">
                Total Cost
              </span>
              <span className="text-2xl font-bold text-warning">
                {fmtCost(stats.totalCost)}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Usage by Model Table */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-border bg-bg-subtle/50">
          <h3 className="font-semibold">Usage by Model</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-bg-subtle/30 text-text-muted uppercase text-xs">
              <tr>
                <th
                  className="px-6 py-3 cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("model", "rawModel")}
                >
                  Model{" "}
                  <SortIcon
                    field="rawModel"
                    currentSort={modelSortBy}
                    currentOrder={modelSortOrder}
                  />
                </th>
                <th
                  className="px-6 py-3 cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("model", "provider")}
                >
                  Provider{" "}
                  <SortIcon
                    field="provider"
                    currentSort={modelSortBy}
                    currentOrder={modelSortOrder}
                  />
                </th>
                <th
                  className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("model", "requests")}
                >
                  Requests{" "}
                  <SortIcon
                    field="requests"
                    currentSort={modelSortBy}
                    currentOrder={modelSortOrder}
                  />
                </th>
                <th
                  className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("model", "lastUsed")}
                >
                  Last Used{" "}
                  <SortIcon
                    field="lastUsed"
                    currentSort={modelSortBy}
                    currentOrder={modelSortOrder}
                  />
                </th>
                {viewMode === "tokens" ? (
                  <>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("model", "promptTokens")}
                    >
                      Input Tokens{" "}
                      <SortIcon
                        field="promptTokens"
                        currentSort={modelSortBy}
                        currentOrder={modelSortOrder}
                      />
                    </th>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("model", "completionTokens")}
                    >
                      Output Tokens{" "}
                      <SortIcon
                        field="completionTokens"
                        currentSort={modelSortBy}
                        currentOrder={modelSortOrder}
                      />
                    </th>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("model", "totalTokens")}
                    >
                      Total Tokens{" "}
                      <SortIcon
                        field="totalTokens"
                        currentSort={modelSortBy}
                        currentOrder={modelSortOrder}
                      />
                    </th>
                  </>
                ) : (
                  <>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("model", "promptTokens")}
                    >
                      Input Cost{" "}
                      <SortIcon
                        field="promptTokens"
                        currentSort={modelSortBy}
                        currentOrder={modelSortOrder}
                      />
                    </th>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("model", "completionTokens")}
                    >
                      Output Cost{" "}
                      <SortIcon
                        field="completionTokens"
                        currentSort={modelSortBy}
                        currentOrder={modelSortOrder}
                      />
                    </th>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("model", "cost")}
                    >
                      Total Cost{" "}
                      <SortIcon
                        field="cost"
                        currentSort={modelSortBy}
                        currentOrder={modelSortOrder}
                      />
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groupedModels.map((group) => (
                <Fragment key={group.groupKey}>
                  <tr
                    key={`summary-${group.groupKey}`}
                    className="group-summary cursor-pointer hover:bg-bg-subtle/50 transition-colors"
                    onClick={() => toggleModelGroup(group.groupKey)}
                  >
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`material-symbols-outlined text-[18px] text-text-muted transition-transform ${expandedModels.has(group.groupKey) ? 'rotate-90' : ''}`}>
                          chevron_right
                        </span>
                        <span className={`font-medium transition-colors ${group.summary.pending > 0 ? "text-primary" : ""}`}>
                          {group.groupKey}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-text-muted">—</td>
                    <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
                    <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                      {fmtTime(group.summary.lastUsed)}
                    </td>
                    {viewMode === "tokens" ? (
                      <>
                        <td className="px-6 py-3 text-right text-text-muted">
                          {fmt(group.summary.promptTokens)}
                        </td>
                        <td className="px-6 py-3 text-right text-text-muted">
                          {fmt(group.summary.completionTokens)}
                        </td>
                        <td className="px-6 py-3 text-right font-medium">
                          {fmt(group.summary.totalTokens)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-3 text-right text-text-muted">
                          {fmtCost(group.summary.inputCost)}
                        </td>
                        <td className="px-6 py-3 text-right text-text-muted">
                          {fmtCost(group.summary.outputCost)}
                        </td>
                        <td className="px-6 py-3 text-right font-medium text-warning">
                          {fmtCost(group.summary.totalCost)}
                        </td>
                      </>
                    )}
                  </tr>
                  {expandedModels.has(group.groupKey) && group.items.map((item) => (
                    <tr
                      key={`detail-${item.key}`}
                      className="group-detail hover:bg-bg-subtle/20 transition-colors"
                    >
                      <td
                        className={`px-6 py-3 font-medium transition-colors ${
                          item.pending > 0 ? "text-primary" : ""
                        }`}
                      >
                        {item.rawModel}
                      </td>
                      <td className="px-6 py-3">
                        <Badge
                          variant={item.pending > 0 ? "primary" : "neutral"}
                          size="sm"
                        >
                          {item.provider}
                        </Badge>
                      </td>
                      <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
                      <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                        {fmtTime(item.lastUsed)}
                      </td>
                      {viewMode === "tokens" ? (
                        <>
                          <td className="px-6 py-3 text-right text-text-muted">
                            {fmt(item.promptTokens)}
                          </td>
                          <td className="px-6 py-3 text-right text-text-muted">
                            {fmt(item.completionTokens)}
                          </td>
                          <td className="px-6 py-3 text-right font-medium">
                            {fmt(item.totalTokens)}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-6 py-3 text-right text-text-muted">
                            {fmtCost(item.inputCost)}
                          </td>
                          <td className="px-6 py-3 text-right text-text-muted">
                            {fmtCost(item.outputCost)}
                          </td>
                          <td className="px-6 py-3 text-right font-medium text-warning">
                            {fmtCost(item.totalCost)}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </Fragment>
              ))}
              {groupedModels.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-6 py-8 text-center text-text-muted"
                  >
                    No usage recorded yet. Make some requests to see data here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Usage by Account Table */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-border bg-bg-subtle/50">
          <h3 className="font-semibold">Usage by Account</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-bg-subtle/30 text-text-muted uppercase text-xs">
              <tr>
                <th
                  className="px-6 py-3 cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("account", "rawModel")}
                >
                  Model{" "}
                  <SortIcon
                    field="rawModel"
                    currentSort={accountSortBy}
                    currentOrder={accountSortOrder}
                  />
                </th>
                <th
                  className="px-6 py-3 cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("account", "provider")}
                >
                  Provider{" "}
                  <SortIcon
                    field="provider"
                    currentSort={accountSortBy}
                    currentOrder={accountSortOrder}
                  />
                </th>
                <th
                  className="px-6 py-3 cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("account", "accountName")}
                >
                  Account{" "}
                  <SortIcon
                    field="accountName"
                    currentSort={accountSortBy}
                    currentOrder={accountSortOrder}
                  />
                </th>
                <th
                  className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("account", "requests")}
                >
                  Requests{" "}
                  <SortIcon
                    field="requests"
                    currentSort={accountSortBy}
                    currentOrder={accountSortOrder}
                  />
                </th>
                <th
                  className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("account", "lastUsed")}
                >
                  Last Used{" "}
                  <SortIcon
                    field="lastUsed"
                    currentSort={accountSortBy}
                    currentOrder={accountSortOrder}
                  />
                </th>
                {viewMode === "tokens" ? (
                  <>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("account", "promptTokens")}
                    >
                      Input Tokens{" "}
                      <SortIcon
                        field="promptTokens"
                        currentSort={accountSortBy}
                        currentOrder={accountSortOrder}
                      />
                    </th>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("account", "completionTokens")}
                    >
                      Output Tokens{" "}
                      <SortIcon
                        field="completionTokens"
                        currentSort={accountSortBy}
                        currentOrder={accountSortOrder}
                      />
                    </th>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("account", "totalTokens")}
                    >
                      Total Tokens{" "}
                      <SortIcon
                        field="totalTokens"
                        currentSort={accountSortBy}
                        currentOrder={accountSortOrder}
                      />
                    </th>
                  </>
                ) : (
                  <>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("account", "promptTokens")}
                    >
                      Input Cost{" "}
                      <SortIcon
                        field="promptTokens"
                        currentSort={accountSortBy}
                        currentOrder={accountSortOrder}
                      />
                    </th>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("account", "completionTokens")}
                    >
                      Output Cost{" "}
                      <SortIcon
                        field="completionTokens"
                        currentSort={accountSortBy}
                        currentOrder={accountSortOrder}
                      />
                    </th>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("account", "cost")}
                    >
                      Total Cost{" "}
                      <SortIcon
                        field="cost"
                        currentSort={accountSortBy}
                        currentOrder={accountSortOrder}
                      />
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groupedAccounts.map((group) => (
                <Fragment key={group.groupKey}>
                  <tr
                    key={`summary-${group.groupKey}`}
                    className="group-summary cursor-pointer hover:bg-bg-subtle/50 transition-colors"
                    onClick={() => toggleAccountGroup(group.groupKey)}
                  >
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`material-symbols-outlined text-[18px] text-text-muted transition-transform ${expandedAccounts.has(group.groupKey) ? 'rotate-90' : ''}`}>
                          chevron_right
                        </span>
                        <span className={`font-medium transition-colors ${group.summary.pending > 0 ? "text-primary" : ""}`}>
                          {group.groupKey}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-text-muted">—</td>
                    <td className="px-6 py-3 text-text-muted">—</td>
                    <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
                    <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                      {fmtTime(group.summary.lastUsed)}
                    </td>
                    {viewMode === "tokens" ? (
                      <>
                        <td className="px-6 py-3 text-right text-text-muted">—</td>
                        <td className="px-6 py-3 text-right text-text-muted">—</td>
                        <td className="px-6 py-3 text-right font-medium">
                          {fmt(group.summary.totalTokens)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-3 text-right text-text-muted">—</td>
                        <td className="px-6 py-3 text-right text-text-muted">—</td>
                        <td className="px-6 py-3 text-right font-medium text-warning">
                          {fmtCost(group.summary.totalCost)}
                        </td>
                      </>
                    )}
                  </tr>
                  {expandedAccounts.has(group.groupKey) && group.items.map((item) => (
                    <tr
                      key={`detail-${item.key}`}
                      className="group-detail hover:bg-bg-subtle/20 transition-colors"
                    >
                      <td className="px-6 py-3">
                        <span
                          className={`font-medium transition-colors ${
                            item.pending > 0 ? "text-primary" : ""
                          }`}
                        >
                          {item.accountName ||
                            `Account ${item.connectionId?.slice(0, 8)}...`}
                        </span>
                      </td>
                      <td
                        className={`px-6 py-3 font-medium transition-colors ${
                          item.pending > 0 ? "text-primary" : ""
                        }`}
                      >
                        {item.rawModel}
                      </td>
                      <td className="px-6 py-3">
                        <Badge
                          variant={item.pending > 0 ? "primary" : "neutral"}
                          size="sm"
                        >
                          {item.provider}
                        </Badge>
                      </td>
                      <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
                      <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                        {fmtTime(item.lastUsed)}
                      </td>
                      {viewMode === "tokens" ? (
                        <>
                          <td className="px-6 py-3 text-right text-text-muted">
                            {fmt(item.promptTokens)}
                          </td>
                          <td className="px-6 py-3 text-right text-text-muted">
                            {fmt(item.completionTokens)}
                          </td>
                          <td className="px-6 py-3 text-right font-medium">
                            {fmt(item.totalTokens)}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-6 py-3 text-right text-text-muted">
                            {fmtCost(item.inputCost)}
                          </td>
                          <td className="px-6 py-3 text-right text-text-muted">
                            {fmtCost(item.outputCost)}
                          </td>
                          <td className="px-6 py-3 text-right font-medium text-warning">
                            {fmtCost(item.totalCost)}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </Fragment>
              ))}
              {groupedAccounts.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-6 py-8 text-center text-text-muted"
                  >
                    No account-specific usage recorded yet. Make requests using
                    OAuth accounts to see data here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="p-4 border-b border-border bg-bg-subtle/50">
          <h3 className="font-semibold">Usage by API Key</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-bg-subtle/30 text-text-muted uppercase text-xs">
              <tr>
                <th
                  className="px-6 py-3 cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("apiKey", "keyName")}
                >
                  API Key Name{" "}
                  <SortIcon
                    field="keyName"
                    currentSort={apiKeySortBy}
                    currentOrder={apiKeySortOrder}
                  />
                </th>
                <th
                  className="px-6 py-3 cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("apiKey", "rawModel")}
                >
                  Model{" "}
                  <SortIcon
                    field="rawModel"
                    currentSort={apiKeySortBy}
                    currentOrder={apiKeySortOrder}
                  />
                </th>
                <th
                  className="px-6 py-3 cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("apiKey", "provider")}
                >
                  Provider{" "}
                  <SortIcon
                    field="provider"
                    currentSort={apiKeySortBy}
                    currentOrder={apiKeySortOrder}
                  />
                </th>
                <th
                  className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("apiKey", "requests")}
                >
                  Requests{" "}
                  <SortIcon
                    field="requests"
                    currentSort={apiKeySortBy}
                    currentOrder={apiKeySortOrder}
                  />
                </th>
                <th
                  className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                  onClick={() => toggleSort("apiKey", "lastUsed")}
                >
                  Last Used{" "}
                  <SortIcon
                    field="lastUsed"
                    currentSort={apiKeySortBy}
                    currentOrder={apiKeySortOrder}
                  />
                </th>
                {viewMode === "tokens" ? (
                  <>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("apiKey", "promptTokens")}
                    >
                      Input Tokens{" "}
                      <SortIcon
                        field="promptTokens"
                        currentSort={apiKeySortBy}
                        currentOrder={apiKeySortOrder}
                      />
                    </th>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("apiKey", "completionTokens")}
                    >
                      Output Tokens{" "}
                      <SortIcon
                        field="completionTokens"
                        currentSort={apiKeySortBy}
                        currentOrder={apiKeySortOrder}
                      />
                    </th>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("apiKey", "totalTokens")}
                    >
                      Total Tokens{" "}
                      <SortIcon
                        field="totalTokens"
                        currentSort={apiKeySortBy}
                        currentOrder={apiKeySortOrder}
                      />
                    </th>
                  </>
                ) : (
                  <>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("apiKey", "promptTokens")}
                    >
                      Input Cost{" "}
                      <SortIcon
                        field="promptTokens"
                        currentSort={apiKeySortBy}
                        currentOrder={apiKeySortOrder}
                      />
                    </th>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("apiKey", "completionTokens")}
                    >
                      Output Cost{" "}
                      <SortIcon
                        field="completionTokens"
                        currentSort={apiKeySortBy}
                        currentOrder={apiKeySortOrder}
                      />
                    </th>
                    <th
                      className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50"
                      onClick={() => toggleSort("apiKey", "cost")}
                    >
                      Total Cost{" "}
                      <SortIcon
                        field="cost"
                        currentSort={apiKeySortBy}
                        currentOrder={apiKeySortOrder}
                      />
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groupedApiKeys.map((group) => (
                <Fragment key={group.groupKey}>
                  <tr
                    key={`summary-${group.groupKey}`}
                    className="group-summary cursor-pointer hover:bg-bg-subtle/50 transition-colors"
                    onClick={() => toggleApiKeyGroup(group.groupKey)}
                  >
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`material-symbols-outlined text-[18px] text-text-muted transition-transform ${expandedApiKeys.has(group.groupKey) ? 'rotate-90' : ''}`}>
                          chevron_right
                        </span>
                        <span className="font-medium">
                          {group.groupKey}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-3 text-text-muted">—</td>
                    <td className="px-6 py-3 text-text-muted">—</td>
                    <td className="px-6 py-3 text-right">{fmt(group.summary.requests)}</td>
                    <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                      {fmtTime(group.summary.lastUsed)}
                    </td>
                    {viewMode === "tokens" ? (
                      <>
                        <td className="px-6 py-3 text-right text-text-muted">
                          {fmt(group.summary.promptTokens)}
                        </td>
                        <td className="px-6 py-3 text-right text-text-muted">
                          {fmt(group.summary.completionTokens)}
                        </td>
                        <td className="px-6 py-3 text-right font-medium">
                          {fmt(group.summary.totalTokens)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-3 text-right text-text-muted">
                          {fmtCost(group.summary.inputCost)}
                        </td>
                        <td className="px-6 py-3 text-right text-text-muted">
                          {fmtCost(group.summary.outputCost)}
                        </td>
                        <td className="px-6 py-3 text-right font-medium text-warning">
                          {fmtCost(group.summary.totalCost)}
                        </td>
                      </>
                    )}
                  </tr>
                  {expandedApiKeys.has(group.groupKey) && group.items.map((item) => (
                    <tr
                      key={`detail-${item.key}`}
                      className="group-detail hover:bg-bg-subtle/20 transition-colors"
                    >
                      <td className="px-6 py-3 font-medium">
                        {item.keyName}
                      </td>
                      <td className="px-6 py-3">
                        {item.rawModel}
                      </td>
                      <td className="px-6 py-3">
                        <Badge variant="neutral" size="sm">
                          {item.provider}
                        </Badge>
                      </td>
                      <td className="px-6 py-3 text-right">{fmt(item.requests)}</td>
                      <td className="px-6 py-3 text-right text-text-muted whitespace-nowrap">
                        {fmtTime(item.lastUsed)}
                      </td>
                      {viewMode === "tokens" ? (
                        <>
                          <td className="px-6 py-3 text-right text-text-muted">
                            {fmt(item.promptTokens)}
                          </td>
                          <td className="px-6 py-3 text-right text-text-muted">
                            {fmt(item.completionTokens)}
                          </td>
                          <td className="px-6 py-3 text-right font-medium">
                            {fmt(item.totalTokens)}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-6 py-3 text-right text-text-muted">
                            {fmtCost(item.inputCost)}
                          </td>
                          <td className="px-6 py-3 text-right text-text-muted">
                            {fmtCost(item.outputCost)}
                          </td>
                          <td className="px-6 py-3 text-right font-medium text-warning">
                            {fmtCost(item.totalCost)}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </Fragment>
              ))}
              {groupedApiKeys.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-6 py-8 text-center text-text-muted"
                  >
                    No API key usage recorded yet. Make requests using API keys to see data here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
