"use client";

import { useState, useEffect, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Card from "./Card";
import Badge from "./Badge";
import { CardSkeleton } from "./Loading";

function SortIcon({ field, currentSort, currentOrder }) {
  if (currentSort !== field) return <span className="ml-1 opacity-20">↕</span>;
  return <span className="ml-1">{currentOrder === "asc" ? "↑" : "↓"}</span>;
}

function MiniBarGraph({ data, colorClass = "bg-primary" }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-1 h-8 w-24">
      {data.slice(-9).map((val, i) => (
        <div
          key={i}
          className={`flex-1 rounded-t-sm transition-all duration-500 ${colorClass}`}
          style={{ height: `${Math.max((val / max) * 100, 5)}%` }}
          title={val}
        />
      ))}
    </div>
  );
}

export default function UsageStats() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const sortBy = searchParams.get("sortBy") || "rawModel";
  const sortOrder = searchParams.get("sortOrder") || "asc";

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const toggleSort = (field) => {
    const params = new URLSearchParams(searchParams.toString());
    if (sortBy === field) {
      params.set("sortOrder", sortOrder === "asc" ? "desc" : "asc");
    } else {
      params.set("sortBy", field);
      params.set("sortOrder", "asc");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const sortData = (dataMap) => {
    return Object.entries(dataMap || {})
      .map(([key, data]) => ({
        ...data,
        key,
        totalTokens: (data.promptTokens || 0) + (data.completionTokens || 0)
      }))
      .sort((a, b) => {
        let valA = a[sortBy];
        let valB = b[sortBy];

        // Handle case-insensitive sorting for strings
        if (typeof valA === "string") valA = valA.toLowerCase();
        if (typeof valB === "string") valB = valB.toLowerCase();

        if (valA < valB) return sortOrder === "asc" ? -1 : 1;
        if (valA > valB) return sortOrder === "asc" ? 1 : -1;
        return 0;
      });
  };

  const sortedModels = useMemo(() => sortData(stats?.byModel), [stats?.byModel, sortBy, sortOrder]);
  const sortedAccounts = useMemo(() => sortData(stats?.byAccount), [stats?.byAccount, sortBy, sortOrder]);

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchStats(false); // fetch without loading skeleton
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const fetchStats = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/usage/history");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch usage stats:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  if (loading) return <CardSkeleton />;

  if (!stats) return <div className="text-text-muted">Failed to load usage statistics.</div>;

  // Format number with commas
  const fmt = (n) => new Intl.NumberFormat().format(n || 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Header with Auto Refresh Toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Usage Overview</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-text-muted flex items-center gap-2 cursor-pointer">
            <span>Auto Refresh (5s)</span>
            <div
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${autoRefresh ? 'bg-primary' : 'bg-bg-subtle border border-border'}`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${autoRefresh ? 'translate-x-5' : 'translate-x-1'}`}
              />
            </div>
          </label>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 flex flex-col gap-1">
          <div className="flex justify-between items-start">
            <div className="flex flex-col gap-1">
              <span className="text-text-muted text-sm uppercase font-semibold">Total Requests</span>
              <span className="text-2xl font-bold">{fmt(stats.totalRequests)}</span>
            </div>
            <MiniBarGraph
              data={(stats.last10Minutes || []).map(m => m.requests)}
              colorClass="bg-text-muted/30"
            />
          </div>
        </Card>
        <Card className="p-4 flex flex-col gap-1">
          <div className="flex justify-between items-start">
            <div className="flex flex-col gap-1">
              <span className="text-text-muted text-sm uppercase font-semibold">Total Input Tokens</span>
              <span className="text-2xl font-bold text-primary">{fmt(stats.totalPromptTokens)}</span>
            </div>
            <MiniBarGraph
              data={(stats.last10Minutes || []).map(m => m.promptTokens)}
              colorClass="bg-primary/50"
            />
          </div>
        </Card>
        <Card className="p-4 flex flex-col gap-1">
          <div className="flex justify-between items-start">
            <div className="flex flex-col gap-1">
              <span className="text-text-muted text-sm uppercase font-semibold">Total Output Tokens</span>
              <span className="text-2xl font-bold text-success">{fmt(stats.totalCompletionTokens)}</span>
            </div>
            <MiniBarGraph
              data={(stats.last10Minutes || []).map(m => m.completionTokens)}
              colorClass="bg-success/50"
            />
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
                <th className="px-6 py-3 cursor-pointer hover:bg-bg-subtle/50" onClick={() => toggleSort("rawModel")}>
                  Model <SortIcon field="rawModel" currentSort={sortBy} currentOrder={sortOrder} />
                </th>
                <th className="px-6 py-3 cursor-pointer hover:bg-bg-subtle/50" onClick={() => toggleSort("provider")}>
                  Provider <SortIcon field="provider" currentSort={sortBy} currentOrder={sortOrder} />
                </th>
                <th className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50" onClick={() => toggleSort("requests")}>
                  Requests <SortIcon field="requests" currentSort={sortBy} currentOrder={sortOrder} />
                </th>
                <th className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50" onClick={() => toggleSort("promptTokens")}>
                  Input Tokens <SortIcon field="promptTokens" currentSort={sortBy} currentOrder={sortOrder} />
                </th>
                <th className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50" onClick={() => toggleSort("completionTokens")}>
                  Output Tokens <SortIcon field="completionTokens" currentSort={sortBy} currentOrder={sortOrder} />
                </th>
                <th className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50" onClick={() => toggleSort("totalTokens")}>
                  Total Tokens <SortIcon field="totalTokens" currentSort={sortBy} currentOrder={sortOrder} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedModels.map((data) => (
                <tr key={data.key} className="hover:bg-bg-subtle/20">
                  <td className="px-6 py-3 font-medium">{data.rawModel}</td>
                  <td className="px-6 py-3">
                    <Badge variant="neutral" size="sm">{data.provider}</Badge>
                  </td>
                  <td className="px-6 py-3 text-right">{fmt(data.requests)}</td>
                  <td className="px-6 py-3 text-right text-text-muted">{fmt(data.promptTokens)}</td>
                  <td className="px-6 py-3 text-right text-text-muted">{fmt(data.completionTokens)}</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(data.totalTokens)}</td>
                </tr>
              ))}
              {sortedModels.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-text-muted">
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
                <th className="px-6 py-3 cursor-pointer hover:bg-bg-subtle/50" onClick={() => toggleSort("rawModel")}>
                  Model <SortIcon field="rawModel" currentSort={sortBy} currentOrder={sortOrder} />
                </th>
                <th className="px-6 py-3 cursor-pointer hover:bg-bg-subtle/50" onClick={() => toggleSort("provider")}>
                  Provider <SortIcon field="provider" currentSort={sortBy} currentOrder={sortOrder} />
                </th>
                <th className="px-6 py-3 cursor-pointer hover:bg-bg-subtle/50" onClick={() => toggleSort("accountName")}>
                  Account <SortIcon field="accountName" currentSort={sortBy} currentOrder={sortOrder} />
                </th>
                <th className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50" onClick={() => toggleSort("requests")}>
                  Requests <SortIcon field="requests" currentSort={sortBy} currentOrder={sortOrder} />
                </th>
                <th className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50" onClick={() => toggleSort("promptTokens")}>
                  Input Tokens <SortIcon field="promptTokens" currentSort={sortBy} currentOrder={sortOrder} />
                </th>
                <th className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50" onClick={() => toggleSort("completionTokens")}>
                  Output Tokens <SortIcon field="completionTokens" currentSort={sortBy} currentOrder={sortOrder} />
                </th>
                <th className="px-6 py-3 text-right cursor-pointer hover:bg-bg-subtle/50" onClick={() => toggleSort("totalTokens")}>
                  Total Tokens <SortIcon field="totalTokens" currentSort={sortBy} currentOrder={sortOrder} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedAccounts.map((data) => (
                <tr key={data.key} className="hover:bg-bg-subtle/20">
                  <td className="px-6 py-3 font-medium">{data.rawModel}</td>
                  <td className="px-6 py-3">
                    <Badge variant="neutral" size="sm">{data.provider}</Badge>
                  </td>
                  <td className="px-6 py-3">
                    <span className="font-medium">{data.accountName || `Account ${data.connectionId?.slice(0, 8)}...`}</span>
                  </td>
                  <td className="px-6 py-3 text-right">{fmt(data.requests)}</td>
                  <td className="px-6 py-3 text-right text-text-muted">{fmt(data.promptTokens)}</td>
                  <td className="px-6 py-3 text-right text-text-muted">{fmt(data.completionTokens)}</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(data.totalTokens)}</td>
                </tr>
              ))}
              {sortedAccounts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-text-muted">
                    No account-specific usage recorded yet. Make requests using OAuth accounts to see data here.
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
