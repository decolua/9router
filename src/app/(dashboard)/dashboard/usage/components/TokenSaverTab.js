"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";
import Pagination from "@/shared/components/Pagination";
import { cn } from "@/shared/utils/cn";

function StatCard({ label, value, sub, icon, color = "text-primary" }) {
  return (
    <div className="flex flex-col gap-1 p-4 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]">
      <div className="flex items-center gap-2 text-text-muted text-xs font-medium uppercase tracking-wide">
        {icon && <span className="material-symbols-outlined text-[16px]">{icon}</span>}
        {label}
      </div>
      <div className={cn("text-2xl font-bold font-mono", color)}>{value}</div>
      {sub && <div className="text-xs text-text-muted">{sub}</div>}
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function TokenSaverTab({ period }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 20,
    totalItems: 0,
    totalPages: 0,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/usage/token-saver?period=${period}&page=${pagination.page}&pageSize=${pagination.pageSize}`
      );
      const json = await res.json();
      setData(json);
      setPagination((prev) => ({
        ...prev,
        totalItems: json.pagination?.totalItems || 0,
        totalPages: json.pagination?.totalPages || 0,
      }));
    } catch (err) {
      console.error("Failed to fetch token saver stats:", err);
    } finally {
      setLoading(false);
    }
  }, [period, pagination.page, pagination.pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPagination((prev) => ({ ...prev, page: 1 }));
  }, [period]);

  const handlePageChange = (newPage) => {
    setPagination((prev) => ({ ...prev, page: newPage }));
  };

  const handlePageSizeChange = (newPageSize) => {
    setPagination((prev) => ({ ...prev, pageSize: newPageSize, page: 1 }));
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center p-12 text-text-muted">
        <span className="material-symbols-outlined animate-spin text-[20px] mr-2">progress_activity</span>
        Loading...
      </div>
    );
  }

  if (!data) return null;

  const { summary, requests } = data;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Status Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Optimized"
          value={`${summary.optimizedRequests}/${summary.totalRequests}`}
          sub="requests with RTK or Caveman"
          icon="compress"
        />
        <StatCard
          label="Bytes Saved"
          value={formatBytes(summary.savedBytes)}
          sub={summary.savedPercent ? `${summary.savedPercent}% reduction` : "—"}
          icon="data_saver_on"
          color="text-emerald-500"
        />
        <StatCard
          label="RTK"
          value={summary.rtkRequests}
          sub={summary.filtersUsed?.length ? summary.filtersUsed.join(", ") : "idle"}
          icon="filter_list"
        />
        <StatCard
          label="Caveman"
          value={summary.cavemanRequests}
          sub={Object.keys(summary.cavemanLevels || {}).join(", ") || "idle"}
          icon="short_text"
        />
      </div>

      {/* Recent optimized requests */}
      <Card title="Recent Optimized Requests" icon="history">
        {requests.length === 0 ? (
          <div className="text-sm text-text-muted p-6">No optimized requests in this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-black/5 dark:border-white/5 text-left text-text-muted">
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2 pr-3">Model</th>
                  <th className="py-2 pr-3">RTK Saved</th>
                  <th className="py-2 pr-3">Caveman</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r, idx) => (
                  <tr key={idx} className="border-b border-black/5 dark:border-white/5 last:border-0">
                    <td className="py-2 pr-3 font-mono text-xs text-text-muted">{new Date(r.timestamp).toLocaleTimeString()}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.provider}</td>
                    <td className="py-2 pr-3 font-mono text-xs truncate max-w-[140px]">{r.model}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-emerald-500">{r.tokenSaver?.rtk ? formatBytes(r.tokenSaver.rtk.savedBytes) : "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.tokenSaver?.caveman?.level || "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Pagination
        currentPage={pagination.page}
        pageSize={pagination.pageSize}
        totalItems={pagination.totalItems}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />
    </div>
  );
}
