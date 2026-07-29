"use client";

import { useEffect, useState } from "react";
import { Card, Button, Input } from "@/shared/components";

export default function OrganizationPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [org, setOrg] = useState(null);
  const [memberCount, setMemberCount] = useState(0);
  const [signupMode, setSignupMode] = useState("invite");

  useEffect(() => {
    fetch("/api/organization")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setOrg(data.organization);
        setMemberCount(data.memberCount || 0);
        setSignupMode(data.signupMode || "invite");
      })
      .catch((err) => setError(err.message || "Failed to load organization"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signupMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setStatus("Organization settings saved");
      setSignupMode(data.signupMode);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-text-muted">Loading organization...</div>;
  }

  if (error && !org) {
    return <div className="p-6 text-red-500">{error}</div>;
  }

  return (
    <div className="p-6 max-w-2xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Organization</h1>
        <p className="text-sm text-text-muted mt-1">Manage your workspace settings</p>
      </div>

      <Card className="flex flex-col gap-4">
        <div>
          <p className="text-xs text-text-muted">Name</p>
          <p className="font-medium">{org?.name}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted">Workspace URL slug</p>
          <p className="font-mono text-sm">{org?.slug}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted">Members</p>
          <p className="font-medium">{memberCount}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted">Plan</p>
          <p className="font-medium capitalize">{org?.plan || "free"}</p>
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <h2 className="font-semibold">Access</h2>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Signup mode</label>
          <select
            className="border border-border rounded px-3 py-2 bg-bg text-sm"
            value={signupMode}
            onChange={(e) => setSignupMode(e.target.value)}
          >
            <option value="invite">Invite only</option>
            <option value="open">Open signup</option>
            <option value="closed">Closed (no new members)</option>
          </select>
          <p className="text-xs text-text-muted">
            Controls how new team members can join this organization.
          </p>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        {status && <p className="text-xs text-green-600">{status}</p>}
        <Button variant="primary" loading={saving} onClick={handleSave}>
          Save changes
        </Button>
      </Card>
    </div>
  );
}
