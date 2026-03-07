"use client";

import { use, useState, useEffect } from "react";
import { Card, Button } from "@/shared/components";
import { useRouter } from "next/navigation";

export default function AdminUserUsagePage({ params }) {
  const { id: userId } = use(params);
  const [usage, setUsage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    async function fetchUsage() {
      try {
        const res = await fetch(`/api/admin/users/${userId}/usage`);
        if (!res.ok) {
          throw new Error("Failed to fetch usage");
        }
        const data = await res.json();
        setUsage(data.recentRequests || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchUsage();
  }, [userId]);

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading usage data...</p>
        </div>
      </div>
    );
  }

  if (error) {
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
        <p className="text-text-muted mt-1">Usage history for user: {userId}</p>
      </div>

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
                  <td className="py-3 px-4 text-sm">{request.promptTokens || 0}</td>
                  <td className="py-3 px-4 text-sm">{request.completionTokens || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {usage.length === 0 && (
            <div className="text-center py-8 text-text-muted">
              No usage data found for this user
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
