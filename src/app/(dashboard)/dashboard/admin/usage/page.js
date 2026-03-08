"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, SegmentedControl, Button } from "@/shared/components";
import OverviewCards from "@/app/(dashboard)/dashboard/usage/components/OverviewCards";
import UsageChart from "@/app/(dashboard)/dashboard/usage/components/UsageChart";

const PERIOD_OPTIONS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All" },
];

const fmt = (n) => (n != null ? new Intl.NumberFormat().format(n) : "0");
const fmtCost = (n) => `$${(n ?? 0).toFixed(2)}`;

export default function AdminUsagePage() {
  const [period, setPeriod] = useState("7d");
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/usage/overview?period=${period}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch overview");
      }
      const data = await res.json();
      setStats(data);
    } catch (err) {
      setError(err.message);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  if (loading && !stats) {
    return (
      <div className="p-8">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading usage overview...</p>
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="p-8">
        <Card>
          <div className="text-center text-red-500">
            <p>Error: {error}</p>
          </div>
        </Card>
      </div>
    );
  }

  const usersSummary = stats?.usersSummary ?? [];

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-primary">Admin: Usage Overview</h1>
        <p className="text-text-muted mt-1">Platform-wide usage across all users</p>
      </div>

      <div className="flex flex-col gap-6">
        <SegmentedControl
          options={PERIOD_OPTIONS}
          value={period}
          onChange={setPeriod}
        />

        {stats && (
          <>
            <OverviewCards stats={stats} />
            {period !== "all" && (
              <UsageChart
                period={period}
                chartEndpoint="/api/admin/usage/chart"
              />
            )}

            <Card>
              <h2 className="text-lg font-semibold text-primary mb-4">Usage by user</h2>
              <p className="text-sm text-text-muted mb-4">
                Tokens and requests per user for the selected period; API key count is total keys set by each user.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 font-medium">User</th>
                      <th className="text-left py-3 px-4 font-medium">Email</th>
                      <th className="text-right py-3 px-4 font-medium">Requests</th>
                      <th className="text-right py-3 px-4 font-medium">Input tokens</th>
                      <th className="text-right py-3 px-4 font-medium">Output tokens</th>
                      <th className="text-right py-3 px-4 font-medium">Est. cost</th>
                      <th className="text-right py-3 px-4 font-medium">API keys</th>
                      <th className="text-right py-3 px-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usersSummary.map((row) => (
                      <tr key={row.userId} className="border-b border-border hover:bg-sidebar">
                        <td className="py-3 px-4 text-sm font-medium">
                          {row.displayName || "—"}
                        </td>
                        <td className="py-3 px-4 text-sm text-text-muted">
                          {row.email || "—"}
                        </td>
                        <td className="py-3 px-4 text-sm text-right">{fmt(row.requests)}</td>
                        <td className="py-3 px-4 text-sm text-right">{fmt(row.promptTokens)}</td>
                        <td className="py-3 px-4 text-sm text-right">{fmt(row.completionTokens)}</td>
                        <td className="py-3 px-4 text-sm text-right">{fmtCost(row.cost)}</td>
                        <td className="py-3 px-4 text-sm text-right">{row.apiKeyCount ?? 0}</td>
                        <td className="py-3 px-4 text-right">
                          <Link href={`/dashboard/admin/users/${row.userId}/usage`}>
                            <Button variant="secondary" size="sm">
                              View usage
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {usersSummary.length === 0 && (
                  <div className="text-center py-8 text-text-muted">
                    No users found
                  </div>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
