"use client";

import { use, useState, useEffect, useCallback } from "react";
import { Card, Button, SegmentedControl } from "@/shared/components";
import OverviewCards from "@/app/(dashboard)/dashboard/usage/components/OverviewCards";
import { useRouter } from "next/navigation";

const PERIOD_OPTIONS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All" },
];

export default function AdminUserUsagePage({ params }) {
  const { id: userId } = use(params);
  const [period, setPeriod] = useState("7d");
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();

  const fetchUsage = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${userId}/usage?period=${period}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch usage");
      }
      const data = await res.json();
      setStats(data);
    } catch (err) {
      setError(err.message);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [userId, period]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  const usage = stats?.recentRequests ?? [];

  if (!userId) {
    return null;
  }

  if (loading && !stats) {
    return (
      <div className="p-8">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading usage data...</p>
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

  return (
    <div className="p-8">
      <div className="mb-6">
        <Button variant="secondary" onClick={() => router.back()} className="mb-4">
          ← Back to Users
        </Button>
        <h1 className="text-2xl font-bold text-primary">User Usage</h1>
        <p className="text-text-muted mt-1">Usage for user: {userId}</p>
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
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-4 font-medium">Timestamp</th>
                      <th className="text-left py-3 px-4 font-medium">Model</th>
                      <th className="text-left py-3 px-4 font-medium">Provider</th>
                      <th className="text-left py-3 px-4 font-medium">Prompt Tokens</th>
                      <th className="text-left py-3 px-4 font-medium">Completion Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.map((request, idx) => (
                      <tr key={idx} className="border-b border-border hover:bg-sidebar">
                        <td className="py-3 px-4 text-sm">
                          {request.timestamp ? new Date(request.timestamp).toLocaleString() : "—"}
                        </td>
                        <td className="py-3 px-4 text-sm">{request.model || "—"}</td>
                        <td className="py-3 px-4 text-sm">{request.provider || "—"}</td>
                        <td className="py-3 px-4 text-sm">{request.promptTokens ?? 0}</td>
                        <td className="py-3 px-4 text-sm">{request.completionTokens ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {usage.length === 0 && (
                  <div className="text-center py-8 text-text-muted">
                    No usage data found for this user in the selected period
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
