"use client";

import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "9router.cliToolEndpointPresets";

function maskApiKey(apiKey) {
  if (!apiKey) return "No API key";
  if (apiKey.length <= 12) return `${apiKey.slice(0, 4)}...`;
  return `${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`;
}

function normalizePresets(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((preset) => preset?.name && preset?.baseUrl && preset?.apiKey);
}

function readPresets() {
  if (typeof window === "undefined") return [];
  try {
    return normalizePresets(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

function writePresets(presets) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizePresets(presets)));
}

export default function EndpointPresetControl({
  baseUrl,
  apiKey,
  onBaseUrlChange,
  onApiKeyChange,
}) {
  const [presets, setPresets] = useState([]);
  const [selectedName, setSelectedName] = useState("");

  useEffect(() => {
    setPresets(readPresets());
  }, []);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.name === selectedName) || null,
    [presets, selectedName]
  );

  const handleSelect = (name) => {
    setSelectedName(name);
    const preset = presets.find((item) => item.name === name);
    if (!preset) return;
    onBaseUrlChange(preset.baseUrl);
    onApiKeyChange(preset.apiKey);
  };

  const handleSave = () => {
    const trimmedBaseUrl = (baseUrl || "").trim();
    const trimmedApiKey = (apiKey || "").trim();
    if (!trimmedBaseUrl || !trimmedApiKey) return;

    let defaultName = selectedPreset?.name || trimmedBaseUrl;
    try {
      defaultName = selectedPreset?.name || new URL(trimmedBaseUrl).host;
    } catch {
      defaultName = selectedPreset?.name || trimmedBaseUrl;
    }
    const name = window.prompt("Preset name", defaultName);
    if (!name?.trim()) return;

    const nextPreset = { name: name.trim(), baseUrl: trimmedBaseUrl, apiKey: trimmedApiKey };
    const nextPresets = [
      ...presets.filter((preset) => preset.name !== nextPreset.name),
      nextPreset,
    ].sort((a, b) => a.name.localeCompare(b.name));

    setPresets(nextPresets);
    setSelectedName(nextPreset.name);
    writePresets(nextPresets);
  };

  const handleDelete = () => {
    if (!selectedPreset) return;
    const nextPresets = presets.filter((preset) => preset.name !== selectedPreset.name);
    setPresets(nextPresets);
    setSelectedName("");
    writePresets(nextPresets);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">Preset</span>
      <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
      <select
        value={selectedName}
        onChange={(event) => handleSelect(event.target.value)}
        className="flex-1 px-2 py-1.5 bg-surface rounded text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary/50"
      >
        <option value="">Manual / current endpoint</option>
        {presets.map((preset) => (
          <option key={preset.name} value={preset.name}>
            {preset.name} - {preset.baseUrl} ({maskApiKey(preset.apiKey)})
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleSave}
        disabled={!baseUrl || !apiKey}
        className="px-2 py-1.5 rounded border text-xs bg-surface border-border text-text-main hover:border-primary disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        title="Save current Base URL and API key as a browser-local preset"
      >
        Save
      </button>
      {selectedPreset && (
        <button
          type="button"
          onClick={handleDelete}
          className="p-1 text-text-muted hover:text-red-500 rounded transition-colors"
          title="Delete selected preset"
        >
          <span className="material-symbols-outlined text-[14px]">delete</span>
        </button>
      )}
    </div>
  );
}
