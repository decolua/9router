"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

/**
 * Settings history: the last mutations with who changed what, and revert.
 *
 * Password and token fields never enter the history - only the restorable
 * surface is listed, and a rollback of an accidental rollback is itself a
 * history entry, so undoing cannot strand the install.
 */
export default function SettingsHistory({ onReverted }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState(null);
  const [error, setError] = useState("");
  // A key-signed session is refused the history; render nothing rather than a
  // misleading "no history" placeholder.
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/history", { cache: "no-store" });
      if (res.status === 401 || res.status === 403) {
        setDenied(true);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setEntries(Array.isArray(data.history) ? data.history : []);
    } catch {
      // panel degrades to "no history"
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const revert = async (id) => {
    if (reverting) return;
    if (typeof window !== "undefined" && !window.confirm("Restore this version of the settings? Current settings are saved again, so this can be undone.")) return;
    setReverting(id);
    setError("");
    try {
      const res = await fetch("/api/settings/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Rollback failed");
      load();
      if (onReverted) onReverted(data.settings);
    } catch (err) {
      setError(err.message || "Rollback failed");
    } finally {
      setReverting(null);
    }
  };

  if (denied) return null;

  if (loading) {
    return (
      <Card padding="md">
        <h3 className="text-sm font-semibold text-text-main mb-2">Settings history</h3>
        <p className="text-xs text-text-muted">Loading…</p>
      </Card>
    );
  }

  if (!entries.length) {
    return (
      <Card padding="md">
        <h3 className="text-sm font-semibold text-text-main mb-2">Settings history</h3>
        <p className="text-xs text-text-muted">
          No changes recorded yet. The next settings change keeps a snapshot here for rollback.
        </p>
      </Card>
    );
  }

  return (
    <Card padding="md">
      <h3 className="text-sm font-semibold text-text-main mb-1">Settings history</h3>
      <p className="text-[11px] text-text-muted mb-3">
        Last {entries.length} change{entries.length === 1 ? "" : "s"}. Passwords and secrets are never stored.
      </p>
      <div className="flex flex-col">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center gap-3 py-2.5 border-b border-border-subtle last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs text-text-main">
                {entry.reason || "settings changed"}
                {entry.actor && <span className="text-text-muted"> · {entry.actor}</span>}
              </p>
              <p className="text-[10px] text-text-muted mt-0.5">
                {new Date(entry.at).toLocaleString()} · {entry.keys?.length || 0} field{entry.keys?.length === 1 ? "" : "s"}
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => revert(entry.id)}
              loading={reverting === entry.id}
              icon="history"
            >
              Revert
            </Button>
          </div>
        ))}
      </div>
      {error && (
        <p className={cn("text-xs mt-2 text-red-500")} role="alert">{error}</p>
      )}
    </Card>
  );
}