"use client";

import { useEffect, useState } from "react";
import { revealApiKey } from "@/shared/utils/revealApiKey";

const CUSTOM_VALUE = "__custom__";

export default function ApiKeySelect({ value, onChange, apiKeys = [], cloudEnabled = false, className = "" }) {
  const [selectedId, setSelectedId] = useState(() => {
    if (value && apiKeys.some((k) => k.key === value)) {
      return apiKeys.find((k) => k.key === value)?.id || CUSTOM_VALUE;
    }
    if (value) return CUSTOM_VALUE;
    return apiKeys[0]?.id || CUSTOM_VALUE;
  });
  const [customInput, setCustomInput] = useState(
    () => (value && !apiKeys.some((k) => k.key === value) ? value : "")
  );
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    if (!value && apiKeys.length > 0 && selectedId !== CUSTOM_VALUE) {
      revealApiKey(apiKeys[0].id).then((full) => {
        if (full) onChange(full);
      });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveAndEmit = async (keyId) => {
    if (!keyId || keyId === CUSTOM_VALUE) return;
    setResolving(true);
    const full = await revealApiKey(keyId);
    setResolving(false);
    if (full) onChange(full);
  };

  const handleSelect = async (e) => {
    const next = e.target.value;
    setSelectedId(next);
    if (next === CUSTOM_VALUE) {
      setCustomInput("");
      onChange("");
      return;
    }
    await resolveAndEmit(next);
  };

  const handleCustomInput = (e) => {
    const v = e.target.value;
    setCustomInput(v);
    onChange(v);
  };

  const noKeys = apiKeys.length === 0 && selectedId !== CUSTOM_VALUE;

  if (noKeys && selectedId !== CUSTOM_VALUE) {
    return (
      <span className={`min-w-0 rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5 ${className}`}>
        {cloudEnabled ? "No API keys - Create one in Keys page" : "sk_9router (default)"}
      </span>
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <select
        value={selectedId}
        onChange={handleSelect}
        disabled={resolving}
        className="w-full min-w-0 px-2 py-2 bg-surface rounded text-xs border border-border focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 sm:py-1.5 disabled:opacity-60"
      >
        {apiKeys.map((k) => (
          <option key={k.id} value={k.id}>
            {k.name} ({k.key})
          </option>
        ))}
        <option value={CUSTOM_VALUE}>Custom...</option>
      </select>
      {selectedId === CUSTOM_VALUE && (
        <input
          type="text"
          value={customInput}
          onChange={handleCustomInput}
          placeholder="sk-..."
          className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 sm:py-1.5"
        />
      )}
    </div>
  );
}
