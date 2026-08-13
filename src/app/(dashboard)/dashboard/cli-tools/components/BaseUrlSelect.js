"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UPDATER_CONFIG } from "@/shared/constants/config";

const STORAGE_KEY = "9router.cliToolEndpointPresets";
const CUSTOM_LAST_KEY = "9router.cliToolEndpointCustom";
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

// Remember the last manually-entered custom URL so re-selecting "Custom URL..."
// repopulates the field instead of showing a blank input.
const readLastCustom = () => {
  if (typeof window === "undefined") return "";
  try { return window.localStorage.getItem(CUSTOM_LAST_KEY) || ""; } catch { return ""; }
};
const writeLastCustom = (url) => {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(CUSTOM_LAST_KEY, url || ""); } catch { /* noop */ }
};

const buildOptions = ({ requiresExternalUrl, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, cloudEnabled, cloudUrl, savedPresets, withV1 }) => {
  const opts = [];
  const wrap = (url) => (withV1 ? ensureV1(url) : (url || "").replace(/\/+$/, ""));
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
    const url = p.baseUrl;
    const label = p.name === url ? url : `${p.name} — ${url}`;
    opts.push({ value: `saved:${p.name}`, label, url, saved: true });
  });
  opts.push({ value: CUSTOM_VALUE, label: "Custom URL...", url: "" });
  return opts;
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
  const [savedPresets, setSavedPresets] = useState([]);
  const [mode, setMode] = useState("");
  const [customInput, setCustomInput] = useState("");
  const initializedRef = useRef(false);

  useEffect(() => {
    setSavedPresets(readSavedPresets());
  }, []);

  const options = useMemo(
    () => buildOptions({ requiresExternalUrl, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, cloudEnabled, cloudUrl, savedPresets, withV1 }),
    [requiresExternalUrl, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl, cloudEnabled, cloudUrl, savedPresets, withV1]
  );

  // Always default to first option (127.0.0.1) on mount, ignore persisted value
  useEffect(() => {
    if (initializedRef.current) return;
    if (options.length === 0) return;
    initializedRef.current = true;
    const first = options.find((o) => o.value !== CUSTOM_VALUE);
    if (first) {
      setMode(first.value);
      onChange(first.url);
    } else {
      setMode(CUSTOM_VALUE);
    }
  }, [options, onChange]);

  const handleSelect = (e) => {
    const next = e.target.value;
    if (next === SAVE_VALUE) {
      const trimmed = (value || "").trim();
      if (!trimmed) return;
      let defaultName = trimmed;
      try { defaultName = new URL(trimmed).host; } catch {}
      const name = window.prompt("Save endpoint as:", defaultName);
      if (!name?.trim()) return;
      const savedName = name.trim();
      const updated = [...savedPresets.filter((p) => p.name !== savedName), { name: savedName, baseUrl: trimmed }]
        .sort((a, b) => a.name.localeCompare(b.name));
      setSavedPresets(updated);
      writeSavedPresets(updated);
      setMode(`saved:${savedName}`);
      onChange(trimmed);
      return;
    }
    setMode(next);
    if (next === CUSTOM_VALUE) {
      // Prefer the current selected URL (so switching from Local/Tunnel keeps
      // that value in the input), then the last remembered custom, else blank.
      const seed = (value || "").trim() || readLastCustom();
      setCustomInput(seed);
      if (seed) {
        writeLastCustom(seed);
        onChange(seed);
      } else {
        onChange("");
      }
      return;
    }
    const opt = options.find((o) => o.value === next);
    if (opt) onChange(opt.url);
  };

  const handleCustomInput = (e) => {
    const v = e.target.value;
    setCustomInput(v);
    onChange(v);
    if (v.trim()) writeLastCustom(v.trim());
  };

  const handleDeleteSaved = () => {
    if (!mode.startsWith("saved:")) return;
    const name = mode.slice(6);
    const updated = savedPresets.filter((p) => p.name !== name);
    setSavedPresets(updated);
    writeSavedPresets(updated);
    const seed = (value || "").trim() || readLastCustom();
    setMode(CUSTOM_VALUE);
    setCustomInput(seed);
    onChange(seed);
  };

  const isSaved = mode.startsWith("saved:");
  const isCustom = mode === CUSTOM_VALUE;
  const canSave = isCustom && (customInput || "").trim().length > 0;

  return (
    <div className="flex flex-col gap-1.5">
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
          <button type="button" onClick={handleDeleteSaved} className="p-1 text-text-muted hover:text-red-500 rounded transition-colors shrink-0" title="Delete saved endpoint">
            <span className="material-symbols-outlined text-[14px]">delete</span>
          </button>
        )}
      </div>
      {isCustom && (
        <input
          type="text"
          value={customInput}
          onChange={handleCustomInput}
          placeholder={withV1 ? "https://example.com/v1" : "https://example.com"}
          className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
        />
      )}
    </div>
  );
}
