"use client";

import { useState } from "react";
import { Badge, Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import KeyAccountPicker from "./KeyAccountPicker";
import KeySection from "./KeySection";

export default function KeyAccounts({ apiKey, connections, reload, onSaved }) {
  const ids = apiKey.allowedConnections || [];
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Starts as a one-line summary; the provider list opens downward on demand.
  const [open, setOpen] = useState(false);
  const selection = draft ?? ids;
  const providers = new Set(
    (connections || [])
      .filter((account) => selection.includes(account.id))
      .map((account) => account.provider),
  );
  const dirty = selection.length !== ids.length || selection.some((id) => !ids.includes(id));

  async function save(next) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/keys/${encodeURIComponent(apiKey.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedConnections: next }),
      });
      if (!response.ok) {
        setError(
          response.status === 401 || response.status === 403
            ? "Sign in as administrator to change allowed accounts"
            : "Could not save allowed accounts",
        );
        return;
      }
      const { key } = await response.json();
      onSaved(key.allowedConnections);
      setDraft(null);
    } catch {
      setError("Could not save allowed accounts");
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeySection
      title="Allowed accounts"
      description="For each provider with a selection, only selected accounts can be used; other providers keep all accounts."
      icon="group"
      collapsible
      // Unsaved changes keep the list open so the save bar stays in view.
      open={open || dirty}
      onToggle={(next) => {
        if (next) reload?.();
        setOpen(next);
      }}
      action={
        <Badge size="sm" variant={selection.length ? "primary" : "default"}>
          {selection.length ? (
            <span data-i18n-skip>
              {`${selection.length} ${translate(selection.length === 1 ? "account" : "accounts")} · ${providers.size} ${translate(providers.size === 1 ? "provider" : "providers")}`}
            </span>
          ) : (
            "All accounts"
          )}
        </Badge>
      }
    >
      <KeyAccountPicker
        connections={connections}
        selected={selection}
        onOpen={reload}
        disabled={saving}
        onChange={(next) => {
          setDraft(next);
          setError("");
        }}
      />
      {connections === false && (
        <Button variant="ghost" onClick={reload}>
          Retry
        </Button>
      )}
      {dirty && (
        <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3">
          <Button size="sm" loading={saving} disabled={!connections} onClick={() => save(selection)}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setDraft(null);
              setError("");
            }}
          >
            Discard
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {translate(error)}
        </p>
      )}
    </KeySection>
  );
}
