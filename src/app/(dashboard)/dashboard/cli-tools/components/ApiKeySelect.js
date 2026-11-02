"use client";

import { useEffect, useMemo, useState } from "react";
import { readKeyPresets, upsertKeyPreset, deleteKeyPreset, subscribeKeyPresets } from "./cliEndpointPresets";

const CUSTOM_VALUE = "__custom__";
const SAVE_VALUE = "__save_key__";

export default function ApiKeySelect({ value, onChange, apiKeys = [], cloudEnabled = false, className = "" }) {
  const [savedKeys, setSavedKeys] = useState([]);
  // Custom mode is sticky once the user types, so an emptied input doesn't jump back to a dropdown option
  const [customMode, setCustomMode] = useState(false);
  const [customInput, setCustomInput] = useState("");

  useEffect(() => {
    const sync = () => setSavedKeys(readKeyPresets());
    sync();
    return subscribeKeyPresets(sync);
  }, []);

  const options = useMemo(
    () => [
      ...apiKeys.map((k) => ({ value: k.key, label: k.key })),
      ...savedKeys.map((p) => ({ value: `saved:${p.name}`, label: p.key, url: p.key, saved: true })),
      { value: CUSTOM_VALUE, label: "Custom...", url: "" },
    ],
    [apiKeys, savedKeys]
  );

  // Derive the active option from value — no sync effects needed when the parent updates it
  const matched = value ? options.find((o) => o.value === value || o.url === value) : null;
  const mode = matched ? matched.value : (customMode || value ? CUSTOM_VALUE : (options[0]?.value ?? CUSTOM_VALUE));
  const inputValue = customMode ? customInput : (value || "");
  const isSaved = typeof mode === "string" && mode.startsWith("saved:");
  const isCustom = mode === CUSTOM_VALUE;
  const canSave = isCustom && (value || "").trim().length > 0 && !apiKeys.some((k) => k.key === value);
  const noKeys = apiKeys.length === 0 && savedKeys.length === 0 && !customMode && !value;

  const handleSelect = (e) => {
    const next = e.target.value;
    if (next === SAVE_VALUE) {
      upsertKeyPreset((value || "").trim());
      return;
    }
    if (next === CUSTOM_VALUE) {
      setCustomMode(true);
      setCustomInput("");
      onChange("");
      return;
    }
    setCustomMode(false);
    setCustomInput("");
    const opt = options.find((o) => o.value === next);
    if (opt) onChange(opt.url ?? opt.value);
  };

  const handleCustomInput = (e) => {
    const v = e.target.value;
    setCustomMode(true);
    setCustomInput(v);
    onChange(v);
  };

  const handleDeleteSaved = () => {
    if (!isSaved) return;
    deleteKeyPreset(mode.slice(6));
    setCustomMode(false);
    setCustomInput("");
    const fallback = options.find((o) => o.value !== CUSTOM_VALUE && o.value !== mode);
    onChange(fallback ? (fallback.url ?? fallback.value) : "");
  };

  if (noKeys) {
    return (
      <span className={`min-w-0 rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5 ${className}`}>
        {cloudEnabled ? "No API keys - Create one in Keys page" : "sk_9router (default)"}
      </span>
    );
  }

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-center gap-2">
        <select
          value={mode}
          onChange={handleSelect}
          className="flex-1 min-w-0 px-2 py-2 bg-surface rounded text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          {canSave && <option value={SAVE_VALUE}>+ Save current as...</option>}
        </select>
        {isSaved && (
          <button type="button" onClick={handleDeleteSaved} className="p-1 text-text-muted hover:text-red-500 rounded transition-colors shrink-0" title="Delete saved key">
            <span className="material-symbols-outlined text-[14px]">delete</span>
          </button>
        )}
      </div>
      {isCustom && (
        <input
          type="text"
          value={inputValue}
          onChange={handleCustomInput}
          placeholder="sk-..."
          className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
        />
      )}
    </div>
  );
}
