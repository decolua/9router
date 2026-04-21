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
    onSave?.({ envVars: nextVars.map(({ masked, ...item }) => item) });
  };

  const handleSave = () => {
    const hasHiddenSecret = draftVars.some(
      (item) => item.key.trim() && item.secret && item.masked && !item.value
    );

    if (hasHiddenSecret) {
      setLocalError("Re-enter masked secret values before saving, or remove those rows.");
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
      subtitle="Store bundle env vars here. Secret values are masked in the dashboard and should be re-entered when you edit this section."
      icon="key"
      action={
        <Button variant="secondary" size="sm" onClick={handleSave} loading={saving}>
          Save env vars
        </Button>
      }
    >
      <div className="space-y-4">
        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        {localError ? <p className="text-sm text-red-600 dark:text-red-400">{localError}</p> : null}

        <div className="space-y-3">
          {draftVars.length === 0 ? (
            <p className="text-sm text-text-muted">No environment variables configured.</p>
          ) : (
            draftVars.map((item, index) => (
              <Card.Section key={`${item.key || "env"}-${index}`} className="space-y-3">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
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
                  <div className="flex items-end">
                    <Button variant="ghost" onClick={() => removeRow(index)}>
                      Remove
                    </Button>
                  </div>
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

        <Button variant="outline" onClick={addRow} icon="add">
          Add env var
        </Button>
      </div>
    </Card>
  );
}
