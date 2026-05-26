"use client";

import { useState, useEffect, useCallback } from "react";
import Card from "@/shared/components/Card";

function formatNumber(n) {
  if (n == null) return "0";
  return n.toLocaleString();
}

function formatCost(n) {
  if (n == null) return "$0.00";
  return `$${n.toFixed(4)}`;
}

function formatTime(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

export default function ApiKeyUsageTable({ period }) {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/usage/by-key?period=${period}`);
      const data = await res.json();
      setKeys(data.keys || []);
    } catch (error) {
      console.error("Failed to fetch usage by key:", error);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <Card padding="none">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px]">
          <thead>
            <tr className="border-b border-black/5 dark:border-white/5">
              <th className="text-left p-4 text-sm font-semibold text-text-main">API Keys</th>
              <th className="text-right p-4 text-sm font-semibold text-text-main">Total Requests</th>
              <th className="text-right p-4 text-sm font-semibold text-text-main">Prompt Tokens</th>
              <th className="text-right p-4 text-sm font-semibold text-text-main">Completion Tokens</th>
              <th className="text-right p-4 text-sm font-semibold text-text-main">Cost</th>
              <th className="text-left p-4 text-sm font-semibold text-text-main">Providers</th>
              <th className="text-left p-4 text-sm font-semibold text-text-main">Last Used</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="7" className="p-8 text-center text-text-muted">
                  <div className="flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined animate-spin text-[20px]">progress_activity</span>
                    Loading...
                  </div>
                </td>
              </tr>
            ) : keys.length === 0 ? (
              <tr>
                <td colSpan="7" className="p-8 text-center text-text-muted">
                  No API key usage found for this period
                </td>
              </tr>
            ) : (
              keys.map((key, index) => (
                <tr
                  key={`${key.apiKey}-${index}`}
                  className="border-b border-black/5 dark:border-white/5 last:border-b-0 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                >
                  <td className="p-4 text-sm text-text-main">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{key.name}</span>
                      <span className="font-mono text-xs text-text-muted">{key.apiKey}</span>
                    </div>
                  </td>
                  <td className="p-4 text-sm text-text-main text-right font-mono">
                    {formatNumber(key.totalRequests)}
                  </td>
                  <td className="p-4 text-sm text-text-main text-right font-mono">
                    {formatNumber(key.promptTokens)}
                  </td>
                  <td className="p-4 text-sm text-text-main text-right font-mono">
                    {formatNumber(key.completionTokens)}
                  </td>
                  <td className="p-4 text-sm text-text-main text-right font-mono">
                    {formatCost(key.cost)}
                  </td>
                  <td className="p-4 text-sm text-text-main">
                    <div className="flex flex-wrap gap-1">
                      {key.providers.map((p) => (
                        <span
                          key={p}
                          className="inline-flex items-center rounded-md bg-black/5 px-1.5 py-0.5 text-xs font-medium text-text-main dark:bg-white/10"
                        >
                          {p}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="whitespace-nowrap p-4 text-sm text-text-muted">
                    {formatTime(key.lastUsed)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
