"use client";

import { useMemo, useRef, useState } from "react";
import { UPDATER_CONFIG } from "@/shared/constants/config";

const STORAGE_KEY = "9router.cliToolEndpointPresets";
const CUSTOM_VALUE = "__custom__";
const SAVE_VALUE = "__save__";

const ensureV1 = (url) => {
  const trimmed = (url || "").replace(/\/+$/, "");
  if (!trimmed) return "";
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
};

const readSavedPresets = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((p) => p?.name && p?.baseUrl);
  } catch {
    return [];
  }
};

const writeSavedPresets = (presets) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
};

const buildOptions = ({
  requiresExternalUrl,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
  cloudEnabled,
  cloudUrl,
  savedPresets,
  withV1,
}) => {
  const opts = [];
  const wrap = (url) =>
    withV1 ? ensureV1(url) : (url || "").replace(/\/+$/, "");
  if (!requiresExternalUrl) {
    const localUrl = wrap(`http://127.0.0.1:${UPDATER_CONFIG.appPort}`);
    opts.push({ value: "local", label: localUrl, url: localUrl });
  }
  if (tunnelEnabled && tunnelPublicUrl) {
    const u = wrap(tunnelPublicUrl);
    opts.push({ value: "tunnel", label: u, url: u });
  }
  if (tailscaleEnabled && tailscaleUrl) {
    const u = wrap(tailscaleUrl);
    opts.push({ value: "tailscale", label: u, url: u });
  }
  if (cloudEnabled && cloudUrl) {
    const u = wrap(cloudUrl);
    opts.push({ value: "cloud", label: u, url: u });
  }
  savedPresets.forEach((p) => {
    opts.push({
      value: `saved:${p.name}`,
      label: p.baseUrl,
      url: p.baseUrl,
      saved: true,
    });
  });
  opts.push({ value: CUSTOM_VALUE, label: "Custom URL...", url: "" });
  return opts;
};

const getInitialMode = ({ options, value }) => {
  const normalizedValue = (value || "").trim();
  const matchedOption = options.find((option) => option.url === normalizedValue);
  if (matchedOption) return matchedOption.value;
  return options.find((option) => option.value !== CUSTOM_VALUE)?.value || CUSTOM_VALUE;
};

export default function BaseUrlSelect({
  value,
  onChange,
  requiresExternalUrl = false,
  tunnelEnabled = false,
  tunnelPublicUrl = "",
  tailscaleEnabled = false,
  tailscaleUrl = "",
  cloudEnabled = false,
  cloudUrl = "",
  withV1 = true,
}) {
  const [savedPresets, setSavedPresets] = useState(() => readSavedPresets());
  const options = useMemo(
    () =>
      buildOptions({
        requiresExternalUrl,
        tunnelEnabled,
        tunnelPublicUrl,
        tailscaleEnabled,
        tailscaleUrl,
        cloudEnabled,
        cloudUrl,
        savedPresets,
        withV1,
      }),
    [
      requiresExternalUrl,
      tunnelEnabled,
      tunnelPublicUrl,
      tailscaleEnabled,
      tailscaleUrl,
      cloudEnabled,
      cloudUrl,
      savedPresets,
      withV1,
    ],
  );
  const [mode, setMode] = useState(() => getInitialMode({ options, value }));
  const [customInput, setCustomInput] = useState(() => {
    const initialMode = getInitialMode({ options, value });
    return initialMode === CUSTOM_VALUE ? value || "" : "";
  });
  const initializedRef = useRef(false);

  const selectedOption = options.find((option) => option.value === mode);
  const fallbackOption =
    options.find((option) => option.value !== CUSTOM_VALUE) || options[0] || null;
  const effectiveMode = selectedOption ? mode : fallbackOption?.value || CUSTOM_VALUE;
  const isSaved = effectiveMode.startsWith("saved:");
  const isCustom = effectiveMode === CUSTOM_VALUE;
  const canSave = isCustom && (customInput || "").trim().length > 0;

  if (!initializedRef.current && fallbackOption) {
    initializedRef.current = true;
    const normalizedValue = (value || "").trim();
    if (!normalizedValue) {
      if (fallbackOption.value !== CUSTOM_VALUE) {
        setMode(fallbackOption.value);
        queueMicrotask(() => onChange(fallbackOption.url));
      }
    } else if (!selectedOption && effectiveMode === CUSTOM_VALUE) {
      setMode(CUSTOM_VALUE);
      setCustomInput(normalizedValue);
    }
  }

  const handleSelect = (e) => {
    const next = e.target.value;
    if (next === SAVE_VALUE) {
      const trimmed = (value || "").trim();
      if (!trimmed) return;
      let defaultName = trimmed;
      try {
        defaultName = new URL(trimmed).host;
      } catch {}
      const name = window.prompt("Save endpoint as:", defaultName);
      if (!name?.trim()) return;
      const updated = [
        ...savedPresets.filter((p) => p.name !== name.trim()),
        { name: name.trim(), baseUrl: trimmed },
      ].sort((a, b) => a.name.localeCompare(b.name));
      setSavedPresets(updated);
      writeSavedPresets(updated);
      return;
    }
    setMode(next);
    if (next === CUSTOM_VALUE) {
      setCustomInput(value || "");
      if (value) return;
      onChange("");
      return;
    }
    const opt = options.find((o) => o.value === next);
    if (opt) onChange(opt.url);
  };

  const handleCustomInput = (e) => {
    const v = e.target.value;
    setCustomInput(v);
    onChange(v);
  };

  const handleDeleteSaved = () => {
    if (!effectiveMode.startsWith("saved:")) return;
    const name = effectiveMode.slice(6);
    const updated = savedPresets.filter((p) => p.name !== name);
    setSavedPresets(updated);
    writeSavedPresets(updated);
    setMode(CUSTOM_VALUE);
    setCustomInput("");
    onChange("");
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <select
          value={effectiveMode}
          onChange={handleSelect}
          className="flex-1 min-w-0 px-2 py-2 bg-surface rounded text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {canSave && <option value={SAVE_VALUE}>+ Save current as...</option>}
        </select>
        {isSaved && (
          <button
            type="button"
            onClick={handleDeleteSaved}
            className="p-1 text-text-muted hover:text-red-500 rounded transition-colors shrink-0"
            title="Delete saved endpoint"
          >
            <span className="material-symbols-outlined text-[14px]">
              delete
            </span>
          </button>
        )}
      </div>
      {isCustom && (
        <input
          type="text"
          value={customInput}
          onChange={handleCustomInput}
          placeholder={
            withV1 ? "https://example.com/v1" : "https://example.com"
          }
          className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
        />
      )}
    </div>
  );
}
