"use client";

import { useState } from "react";
import { Button, Card, Input, Toggle } from "@/shared/components";

function createEmptyEnvVar() {
  return {
    key: "",
    value: "",
    secret: true,
  };
}

export default function EnvVarsCard({ preferences, saving = false, error = "", onSave }) {
  const [draftVars, setDraftVars] = useState(() =>
    (preferences?.envVars || []).map((item) => ({
      key: item.key || "",
      value: item.secret ? "" : item.value || "",
      secret: item.secret === true,
      masked: item.secret === true,
    }))
  );
  const [localError, setLocalError] = useState("");

  const updateItem = (index, patch) => {
    setDraftVars((current) => current.map((item, currentIndex) => (currentIndex === index ? { ...item, ...patch } : item)));
  };

  const addRow = () => {
    setDraftVars((current) => [...current, createEmptyEnvVar()]);
  };

  const removeRow = (index) => {
    const nextVars = draftVars.filter((_, currentIndex) => currentIndex !== index);
    setDraftVars(nextVars);
  };

  const handleSave = () => {
    const hasHiddenValue = draftVars.some(
      (item) => item.key.trim() && item.masked && !item.value
    );

    if (hasHiddenValue) {
      setLocalError("Re-enter masked values before saving, or remove those rows.");
      return;
    }

    setLocalError("");

    const payload = draftVars
      .filter((item) => item.key.trim())
      .map(({ masked, ...item }) => ({
        key: item.key.trim(),
        value: item.value,
        secret: item.secret === true,
      }));

    onSave?.({ envVars: payload });
  };

  return (
    <Card
      title="Environment variables"
      subtitle="Optional: store environment variables that should be reflected in the generated config. Secret values stay masked here and should be re-entered when you edit them."
      icon="key"
      className="rounded-[24px] border-black/5 shadow-[0_16px_42px_rgba(0,0,0,0.04)] dark:border-white/5"
      action={
        <Button variant="secondary" size="sm" onClick={handleSave} loading={saving}>
          Save env vars
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="rounded-[24px] border border-primary/10 bg-gradient-to-br from-primary/[0.05] via-transparent to-transparent px-5 py-[1.125rem]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-text-main">Config-backed variables</p>
              <p className="text-xs leading-5 text-text-muted">Secrets remain masked in the UI and should be re-entered before saving changes.</p>
            </div>
            <div className="rounded-full border border-primary/15 bg-primary/8 px-3 py-1 text-xs font-medium text-primary">
              {draftVars.length} row{draftVars.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        {localError ? <p className="text-sm text-red-600 dark:text-red-400">{localError}</p> : null}

        <div className="space-y-4">
          {draftVars.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-black/8 bg-black/[0.015] px-5 py-6 text-sm text-text-muted dark:border-white/10 dark:bg-white/[0.015]">No environment variables configured yet.</div>
          ) : (
            draftVars.map((item, index) => (
              <Card.Section key={`${item.key || "env"}-${index}`} className="space-y-5 rounded-[24px] border border-black/5 bg-white/[0.75] px-5 py-5 dark:border-white/5 dark:bg-white/[0.02]">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-text-main">Variable {index + 1}</p>
                    <p className="mt-1 text-xs leading-5 text-text-muted">{item.secret ? "Stored as a secret" : "Stored as plain text in preview"}</p>
                  </div>
                  <Button variant="ghost" onClick={() => removeRow(index)}>
                    Remove
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <Input
                    label="Key"
                    value={item.key}
                    onChange={(event) => updateItem(index, { key: event.target.value })}
                    placeholder="OPENAI_API_KEY"
                  />
                  <Input
                    label="Value"
                    type={item.secret ? "password" : "text"}
                    value={item.value}
                    onChange={(event) => updateItem(index, { value: event.target.value, masked: false })}
                    placeholder={item.masked ? "Saved secret — enter a new value to replace it" : "sk-..."}
                  />
                </div>
                <Toggle
                  checked={item.secret}
                  onChange={(checked) => updateItem(index, { secret: checked })}
                  label="Treat as secret"
                  description="Secret values render as masked inputs in the dashboard."
                />
              </Card.Section>
            ))
          )}
        </div>

        <div className="flex justify-start pt-1">
          <Button variant="outline" onClick={addRow} icon="add">
            Add env var
          </Button>
        </div>
      </div>
    </Card>
  );
}
