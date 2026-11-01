"use client";

import { useState, useEffect } from "react";
import Card from "./Card";

export default function RequestLogger() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    fetchLogs();
  }, []);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        fetchLogs(false);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const fetchLogs = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await fetch("/api/usage/request-logs");
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (error) {
      console.error("Failed to fetch logs:", error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Request Logs</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-text-muted flex items-center gap-2 cursor-pointer">
            <span>Auto Refresh (3s)</span>
            <div
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${autoRefresh ? "bg-primary" : "bg-bg-subtle border border-border"
                }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${autoRefresh ? "translate-x-5" : "translate-x-1"
                  }`}
              />
            </div>
          </label>
        </div>
      </div>

      <Card className="overflow-hidden bg-surface border border-border-subtle">
        <div className="p-0 overflow-x-auto max-h-[600px] overflow-y-auto font-mono text-xs">
          {loading && logs.length === 0 ? (
            <div className="p-8 text-center text-text-muted">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-text-muted">No logs recorded yet.</div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 bg-bg-subtle border-b border-border z-10">
                <tr>
                  <th className="px-3 py-2 border-r border-border">DateTime</th>
                  <th className="px-3 py-2 border-r border-border">Model</th>
                  <th className="px-3 py-2 border-r border-border">Provider</th>
                  <th className="px-3 py-2 border-r border-border">Account</th>
                  <th className="px-3 py-2 border-r border-border">In</th>
                  <th className="px-3 py-2 border-r border-border">Out</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {logs.map((log, i) => {
                  // The API returns one object per row now. A pipe string is only
                  // still accepted so an old cached response cannot blank the
                  // table while a tab reloads.
                  const row =
                    typeof log === "string"
                      ? (() => {
                          const parts = log.split(" | ");
                          if (parts.length < 7) return null;
                          return { ts: parts[0], model: parts[1], provider: parts[2], account: parts[3], sent: parts[4], received: parts[5], status: parts[6] };
                        })()
                      : log;
                  if (!row) return null;

                  const status = String(row.status || "");
                  const statusKey = status.toLowerCase();
                  const isPending = statusKey.includes("pending");
                  const isFailed = statusKey.includes("fail") || statusKey.includes("error");
                  // Stored statuses are lowercase (`ok`, `502`), so an
                  // uppercase-only test painted every successful row as pending.
                  const isSuccess = statusKey.includes("ok");

                  return (
                    <tr key={i} className={`hover:bg-primary/5 transition-colors ${isPending ? 'bg-primary/5' : ''}`}>
                      <td className="px-3 py-1.5 border-r border-border text-text-muted">{row.ts}</td>
                      <td className="px-3 py-1.5 border-r border-border font-medium">{row.model}</td>
                      <td className="px-3 py-1.5 border-r border-border">
                        <span className="px-1.5 py-0.5 rounded bg-bg-subtle border border-border text-xs font-semibold">
                          {row.provider}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-border truncate max-w-[200px]" title={row.account}>{row.account}</td>
                      <td className="px-3 py-1.5 border-r border-border text-right text-primary">{row.sent}</td>
                      <td className="px-3 py-1.5 border-r border-border text-right text-success">{row.received}</td>
                      <td className={`px-3 py-1.5 font-bold ${isSuccess ? 'text-success' :
                          isFailed ? 'text-error' :
                            'text-primary animate-pulse'
                        }`}>
                        {status.toUpperCase()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      <div className="text-[10px] text-text-muted italic">
        Logs are loaded from the request history database.
      </div>
    </div>
  );
}
