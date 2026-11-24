"use client";

import { useState } from "react";
import { Button, Card, ConfirmModal, Input } from "@/shared/components";

const list = (text) =>
  text
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

export function SettingsCard({ icon, title, heading: Heading = "h3", children }) {
  return (
    <Card>
      <div className="mb-4 flex items-center gap-3">
        <div className="shrink-0 rounded-lg bg-primary/10 p-2 text-primary">
          <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
            {icon}
          </span>
        </div>
        <Heading className="text-base sm:text-lg font-semibold">{title}</Heading>
      </div>
      {children}
    </Card>
  );
}

export default function SessionSettings({ settings }) {
  const [emails, setEmails] = useState(() => settings.ssoAdminEmails.join(", "));
  const [groups, setGroups] = useState(() => settings.ssoAdminGroups.join(", "));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssoAdminEmails: list(emails), ssoAdminGroups: list(groups) }),
      });
      if (!res.ok) throw new Error();
      setMessage("SSO administrator lists saved.");
    } catch {
      setMessage("Could not save SSO administrator lists.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/sessions/revoke", { method: "POST" });
      if (!res.ok) throw new Error();
      window.location.replace("/login");
    } catch {
      setConfirm(false);
      setMessage("Could not end dashboard sessions.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsCard icon="admin_panel_settings" title="Dashboard access">
      <p className="my-3 text-sm text-text-muted">
        Other SSO users have read-only access. Separate entries with commas.
      </p>
      <form onSubmit={save} className="grid items-end gap-4 sm:grid-cols-2">
        <Input
          id="sso-admin-emails"
          label="SSO administrator emails"
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
        />
        <Input
          id="sso-admin-groups"
          label="SSO administrator groups"
          value={groups}
          onChange={(e) => setGroups(e.target.value)}
        />
        <Button type="submit" className="justify-self-start sm:col-span-2" disabled={busy}>
          Save access rules
        </Button>
      </form>
      <div className="mt-4 border-t border-border pt-4">
        <Button variant="danger" disabled={busy} onClick={() => setConfirm(true)}>
          End all sessions
        </Button>
      </div>
      <p role="status" className="mt-2 text-sm">
        {message}
      </p>
      <ConfirmModal
        isOpen={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={revoke}
        title="End all sessions"
        message="Everyone, including you, will need to sign in again."
        confirmText="End all sessions"
        loading={busy}
      />
    </SettingsCard>
  );
}
