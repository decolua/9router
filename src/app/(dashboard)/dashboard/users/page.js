"use client";

import { useEffect, useState } from "react";
import { Card, Button, Input } from "@/shared/components";

export default function UsersAdminPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [lastInvite, setLastInvite] = useState(null);
  const [lastReset, setLastReset] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);

  async function loadUsers() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load users");
      setUsers(data.users || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  async function createInvite(e) {
    e.preventDefault();
    setCreating(true);
    setError("");
    setLastInvite(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create invite");
      setLastInvite(data);
      setInviteEmail("");
      await loadUsers();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function setRole(id, role) {
    setBusyId(id);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update role");
      await loadUsers();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function issuePasswordReset(id, email) {
    if (!confirm(`Issue a password reset link for ${email}?`)) return;
    setBusyId(id);
    setLastReset(null);
    try {
      const res = await fetch("/api/users", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to issue reset link");
      setLastReset({ email, resetUrl: data.resetUrl, message: data.message, emailed: data.emailed });
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(id, status) {
    const label = status === "disabled" ? "disable" : "enable";
    if (!confirm(`${label.charAt(0).toUpperCase()}${label.slice(1)} this user?`)) return;
    setBusyId(id);
    try {
      const res = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${label} user`);
      await loadUsers();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function removeUser(id, email) {
    if (!confirm(
      `Permanently delete ${email}?\n\nThis removes their account and all their providers, API keys, usage history, and request logs. This cannot be undone.`
    )) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/users?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete user");
      await loadUsers();
    } catch (e) {
      alert(e.message);
    } finally {
      setBusyId(null);
    }
  }

  function statusBadge(status) {
    const active = status === "active";
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full ${active ? "bg-green-500/15 text-green-600 dark:text-green-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
        {status}
      </span>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Team members</h1>
        <p className="text-text-muted text-sm mt-1">
          Each user has an isolated workspace. Disable blocks sign-in; delete permanently removes their account and data.
        </p>
      </div>

      <Card>
        <h2 className="font-semibold mb-3">Invite a user</h2>
        <form onSubmit={createInvite} className="flex flex-col gap-3">
          <Input
            type="email"
            placeholder="Optional: restrict invite to this email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <Button type="submit" loading={creating}>Generate invite link</Button>
        </form>
        {lastInvite && (
          <div className="mt-4 p-3 bg-sidebar rounded text-xs break-all">
            <p className="font-medium mb-1">Share this signup link:</p>
            <code>{lastInvite.signupUrl || lastInvite.token}</code>
          </div>
        )}
      </Card>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      {lastReset && (
        <Card>
          <p className="font-semibold mb-1">
            Password reset for {lastReset.email}
          </p>
          <p className="text-sm text-text-muted mb-3">{lastReset.message}</p>
          {lastReset.resetUrl ? (
            <div className="p-3 bg-sidebar rounded text-xs break-all">
              <p className="font-medium mb-1">Share this one-time reset link:</p>
              <code>{lastReset.resetUrl}</code>
            </div>
          ) : null}
        </Card>
      )}

      <Card>
        <h2 className="font-semibold mb-3">Users</h2>
        {loading ? (
          <p className="text-text-muted text-sm">Loading...</p>
        ) : (
          <ul className="divide-y divide-border">
            {users.map((u) => {
              const isBusy = busyId === u.id;
              const isAdmin = u.role === "admin";
              return (
                <li key={u.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{u.name || u.email}</p>
                    <p className="text-xs text-text-muted truncate">
                      {u.email} · {u.role}{u.mfaEnabled ? " · MFA" : ""}
                    </p>
                    <div className="mt-1">{statusBadge(u.status)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    {!isAdmin && (
                      <select
                        className="text-xs border border-border rounded px-2 py-1 bg-bg"
                        value={u.role}
                        disabled={isBusy}
                        onChange={(e) => setRole(u.id, e.target.value)}
                      >
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                      </select>
                    )}
                    <Button variant="secondary" size="sm" loading={isBusy} disabled={isBusy} onClick={() => issuePasswordReset(u.id, u.email)}>
                      Reset password
                    </Button>
                    {u.status === "active" && !isAdmin && (
                      <Button variant="secondary" size="sm" disabled={isBusy} onClick={() => setStatus(u.id, "disabled")}>
                        Disable
                      </Button>
                    )}
                    {u.status === "disabled" && (
                      <Button variant="secondary" size="sm" disabled={isBusy} onClick={() => setStatus(u.id, "active")}>
                        Enable
                      </Button>
                    )}
                    {!isAdmin && (
                      <Button variant="secondary" size="sm" disabled={isBusy} onClick={() => removeUser(u.id, u.email)}>
                        Delete
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
