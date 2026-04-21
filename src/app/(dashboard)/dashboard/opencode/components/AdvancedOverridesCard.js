"use client";

import { useMemo, useState } from "react";
import { Button, Card } from "@/shared/components";

export default function AdvancedOverridesCard({ preferences, saving = false, error = "", onSave }) {
  const variant = preferences?.variant || "openagent";
  const initialValue = useMemo(
    () => JSON.stringify(preferences?.advancedOverrides?.[variant] || {}, null, 2),
    [preferences?.advancedOverrides, variant]
  );
  const [value, setValue] = useState(initialValue);
  const [parseError, setParseError] = useState("");
  const [collapsed, setCollapsed] = useState(true);

  const handleSave = () => {
    try {
      const parsed = value.trim() ? JSON.parse(value) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Overrides must be a JSON object");
      }

      setParseError("");
      onSave?.({
        advancedOverrides: {
          ...(preferences?.advancedOverrides || {}),
          [variant]: parsed,
        },
      });
      setCollapsed(true);
    } catch (saveError) {
      setParseError(saveError.message || "Invalid JSON overrides");
    }
  };

  return (
    <Card
      title="Advanced overrides"
      subtitle={`Edit raw JSON overrides for the ${variant} variant. Template defaults are merged on the server.`}
      icon="settings"
      action={
        <Button variant="ghost" size="sm" onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? "Show editor" : "Hide editor"}
        </Button>
      }
    >
      {collapsed ? (
        <p className="text-sm text-text-muted">
          Overrides are collapsed by default. Expand to edit raw JSON for this variant.
        </p>
      ) : (
        <div className="space-y-3">
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          {parseError ? <p className="text-sm text-red-600 dark:text-red-400">{parseError}</p> : null}
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="min-h-[240px] w-full rounded-lg border border-black/10 bg-white px-3 py-3 font-mono text-sm text-text-main shadow-inner outline-none transition-all focus:border-primary/50 focus:ring-1 focus:ring-primary/30 dark:border-white/10 dark:bg-white/5"
            spellCheck={false}
          />
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={handleSave} loading={saving}>
              Save overrides
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
