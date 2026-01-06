"use client";

import { useState, useEffect } from "react";
import Card from "./Card";
import Badge from "./Badge";
import { CardSkeleton } from "./Loading";

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
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);

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
                <th className="px-6 py-3">Model</th>
                <th className="px-6 py-3">Provider</th>
                <th className="px-6 py-3 text-right">Requests</th>
                <th className="px-6 py-3 text-right">Input Tokens</th>
                <th className="px-6 py-3 text-right">Output Tokens</th>
                <th className="px-6 py-3 text-right">Total Tokens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Object.entries(stats.byModel || {}).map(([key, data]) => (
                <tr key={key} className="hover:bg-bg-subtle/20">
                  <td className="px-6 py-3 font-medium">{data.rawModel}</td>
                  <td className="px-6 py-3">
                    <Badge variant="neutral" size="sm">{data.provider}</Badge>
                  </td>
                  <td className="px-6 py-3 text-right">{fmt(data.requests)}</td>
                  <td className="px-6 py-3 text-right text-text-muted">{fmt(data.promptTokens)}</td>
                  <td className="px-6 py-3 text-right text-text-muted">{fmt(data.completionTokens)}</td>
                  <td className="px-6 py-3 text-right font-medium">{fmt(data.promptTokens + data.completionTokens)}</td>
                </tr>
              ))}
              {Object.keys(stats.byModel || {}).length === 0 && (
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
                <th className="px-6 py-3">Model</th>
                <th className="px-6 py-3">Provider</th>
                <th className="px-6 py-3">Account</th>
                <th className="px-6 py-3 text-right">Requests</th>
                <th className="px-6 py-3 text-right">Input Tokens</th>
                <th className="px-6 py-3 text-right">Output Tokens</th>
                <th className="px-6 py-3 text-right">Total Tokens</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Object.entries(stats.byAccount || {}).map(([key, data]) => (
                <tr key={key} className="hover:bg-bg-subtle/20">
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
                  <td className="px-6 py-3 text-right font-medium">{fmt(data.promptTokens + data.completionTokens)}</td>
                </tr>
              ))}
              {Object.keys(stats.byAccount || {}).length === 0 && (
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
