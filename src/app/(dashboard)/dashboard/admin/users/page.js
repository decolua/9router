"use client";

import { useState, useEffect } from "react";
import { Card, Button } from "@/shared/components";
import Link from "next/link";

export default function AdminUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [approvingId, setApprovingId] = useState(null);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("Failed to fetch users");
      const data = await res.json();
      setUsers(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleApprove = async (userId) => {
    setApprovingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Update failed");
      }
      await fetchUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setApprovingId(null);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-text-muted mt-4">Loading users...</p>
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
            <p className="text-sm text-text-muted mt-2">Make sure you have admin access</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-primary">Admin: Users</h1>
        <p className="text-text-muted mt-1">Manage users and view usage</p>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-4 font-medium">Email</th>
                <th className="text-left py-3 px-4 font-medium">Display Name</th>
                <th className="text-left py-3 px-4 font-medium">Role</th>
                <th className="text-left py-3 px-4 font-medium">Status</th>
                <th className="text-left py-3 px-4 font-medium">Usage (7d)</th>
                <th className="text-left py-3 px-4 font-medium">Created</th>
                <th className="text-left py-3 px-4 font-medium">Last Login</th>
                <th className="text-left py-3 px-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-b border-border hover:bg-sidebar">
                  <td className="py-3 px-4">{user.email || "—"}</td>
                  <td className="py-3 px-4">{user.displayName || "—"}</td>
                  <td className="py-3 px-4">
                    {user.isAdmin ? (
                      <span className="px-2 py-1 bg-primary/10 text-primary rounded text-sm font-medium">Admin</span>
                    ) : (
                      <span className="text-text-muted">User</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {user.status === "pending" ? (
                      <span className="px-2 py-1 bg-amber-500/20 text-amber-600 dark:text-amber-400 rounded text-sm font-medium">Pending</span>
                    ) : (
                      <span className="px-2 py-1 bg-green-500/20 text-green-600 dark:text-green-400 rounded text-sm font-medium">Active</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-sm text-text-muted">
                    {user.usageSummary
                      ? `${user.usageSummary.requests7d ?? 0} req · ~$${(user.usageSummary.cost7d ?? 0).toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="py-3 px-4 text-sm text-text-muted">
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-3 px-4 text-sm text-text-muted">
                    {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-3 px-4 flex items-center gap-2">
                    {user.status === "pending" && (
                      <Button
                        variant="primary"
                        size="sm"
                        loading={approvingId === user.id}
                        onClick={() => handleApprove(user.id)}
                      >
                        Approve
                      </Button>
                    )}
                    <Link href={`/dashboard/admin/users/${user.id}/usage`}>
                      <Button variant="secondary" size="sm">
                        View Usage
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          
          {users.length === 0 && (
            <div className="text-center py-8 text-text-muted">
              No users found
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
