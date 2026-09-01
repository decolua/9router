import { UPDATER_CONFIG } from "@/shared/constants/config";

// Browser-local endpoint presets shared by every CLI tool card
const STORAGE_KEY = "9router.cliToolEndpointPresets";
const CHANGE_EVENT = "9router:endpoint-presets-changed";

const stripSlash = (url) => (url || "").replace(/\/+$/, "");

export function readPresets() {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((p) => p?.name && p?.baseUrl);
  } catch {
    return [];
  }
}

function writePresets(presets) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function subscribePresets(handler) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

function defaultNameFor(url) {
  try { return new URL(url).host; } catch { return url; }
}

// Adds or replaces a preset; returns the stored name, or null when skipped
export function upsertPreset(baseUrl, name) {
  const url = stripSlash(baseUrl);
  if (!url) return null;

  const presets = readPresets();
  const existing = presets.find((p) => stripSlash(p.baseUrl) === url);
  if (existing && !name) return existing.name;

  const finalName = (name || defaultNameFor(url)).trim();
  if (!finalName) return null;

  const next = [...presets.filter((p) => p.name !== finalName && stripSlash(p.baseUrl) !== url), { name: finalName, baseUrl: url }]
    .sort((a, b) => a.name.localeCompare(b.name));
  writePresets(next);
  return finalName;
}

// Save an applied endpoint unless it exactly matches a built-in dropdown option
export function rememberEndpoint(baseUrl, { tunnelPublicUrl, tailscaleUrl, cloudUrl } = {}) {
  const url = stripSlash(baseUrl);
  if (!url) return null;

  const builtIns = [`http://127.0.0.1:${UPDATER_CONFIG.appPort}`, tunnelPublicUrl, tailscaleUrl, cloudUrl]
    .filter(Boolean)
    .flatMap((u) => [stripSlash(u), `${stripSlash(u)}/v1`]);
  if (builtIns.includes(url)) return null;

  return upsertPreset(url);
}

export function deletePreset(name) {
  writePresets(readPresets().filter((p) => p.name !== name));
}

export { stripSlash };
