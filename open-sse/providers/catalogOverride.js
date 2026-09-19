// Read side of the model catalog synced from models.dev.
//
// The file is the source of truth; the only thing held in memory is a parsed
// copy dropped as soon as the file's mtime changes. getCapabilitiesForModel is
// synchronous and runs per request, so the hot path is one stat (~1us) and the
// parse (~0.1ms on a ~18KB file) only reruns after a sync.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

export const CATALOG_FILE = path.join(DATA_DIR, "model-catalog.json");
// Trimmed upstream catalog, read by the add-models skill (not by the router).
export const CATALOG_RAW_FILE = path.join(DATA_DIR, "model-catalog-raw.json");

const EMPTY = { models: {}, providers: {}, costs: {}, lifecycle: {} };
const TEST_CACHE_MTIME = -2; // sentinel: skip disk reload (see __setCatalogCacheForTests)
let cache = EMPTY;
let cachedMtime = -1;

// "zai-org/GLM-4.6V:free" -> "glm-4.6v"
function baseId(model) {
  if (!model) return "";
  const withoutVendor = model.includes("/") ? model.split("/").pop() : model;
  return withoutVendor.toLowerCase().split(":")[0];
}

function load() {
  if (cachedMtime === TEST_CACHE_MTIME) return cache;
  let mtime;
  try {
    mtime = fs.statSync(CATALOG_FILE).mtimeMs;
  } catch {
    cache = EMPTY;
    cachedMtime = -1;
    return cache;
  }
  if (mtime === cachedMtime) return cache;

  cachedMtime = mtime;
  try {
    const parsed = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
    cache = {
      models: parsed?.models || {},
      providers: parsed?.providers || {},
      costs: parsed?.costs || {},
      // Absent in files written before T-D — treated as "feed knows nothing",
      // which is exactly the pre-lifecycle behaviour.
      lifecycle: parsed?.lifecycle || {},
    };
  } catch {
    cache = EMPTY;
  }
  return cache;
}
// Modality is a property of the model itself — any gateway serving it inherits
// the same image/video/pdf support, so this is keyed by model id alone.
export function getCatalogModalities(model) {
  return load().models[baseId(model)] || null;
}

// Context and output limits are a property of the gateway, not the model: each
// one truncates differently, so these stay keyed by provider + model.
export function getCatalogLimits(provider, model) {
  const byProvider = provider && load().providers[provider];
  if (!byProvider) return null;
  return byProvider[model] || byProvider[baseId(model)] || null;
}

// Tier precedence #2: per-model cost from models.dev, keyed by 9router
// provider + base model id. Only consulted when the account's own /models
// listing left the tier unknown — never overrides provider-reported prices.
//
// When the provider itself has no cost row, fall back to the OpenRouter index
// (same base id). That keeps gateway/reseller models priced consistently.
export function getCatalogCost(provider, model) {
  const costs = load().costs || {};
  const byProvider = provider && costs[provider];
  if (byProvider) {
    const hit = byProvider[model] || byProvider[baseId(model)];
    if (hit) return hit;
  }
  if (provider === "openrouter") return null;
  const openrouter = costs.openrouter;
  if (!openrouter) return null;
  return openrouter[model] || openrouter[baseId(model)] || null;
}

// models.dev lifecycle: `model.status` (schema today: alpha|beta|deprecated).
// Normalized so the writers' synonyms collapse to one vocabulary the consumers
// compare against. Unknown future words pass through lowercased — they can
// only ever annotate, never hide: hiding requires an explicit retired synonym.
const LIFECYCLE_SYNONYMS = {
  retired: "retired", eol: "retired", "end-of-life": "retired", end_of_life: "retired",
  shutdown: "retired", sunset: "retired",
  deprecated: "deprecated", deprecating: "deprecated",
  alpha: "alpha", experimental: "alpha",
  beta: "beta", preview: "beta",
};

export function normalizeLifecycleStatus(status) {
  if (typeof status !== "string") return null;
  const value = status.trim().toLowerCase();
  if (!value) return null;
  return LIFECYCLE_SYNONYMS[value] || value;
}

// Lifecycle is a property of the model, not of the gateway that serves it —
// when the provider itself has no status row, fall back to the OpenRouter
// index (same base id), exactly like getCatalogCost. The caller decides what
// a hit means; hiding additionally requires the absence of live account
// evidence (docs/MODEL_SYNC_CATALOG.md — an account catalogue beats the feed).
export function getCatalogLifecycle(provider, model) {
  const lifecycle = load().lifecycle || {};
  const pick = (byProvider) => {
    if (!byProvider) return null;
    const raw = byProvider[model] !== undefined ? byProvider[model] : byProvider[baseId(model)];
    return normalizeLifecycleStatus(raw);
  };
  if (provider) {
    const hit = pick(lifecycle[provider]);
    if (hit) return hit;
  }
  if (provider === "openrouter") return null;
  return pick(lifecycle.openrouter);
}

// Force a re-read on the next lookup (called right after a sync writes the file).
export function invalidateCatalog() {
  cachedMtime = -1;
}

// Test-only: inject a parsed catalog without touching disk.
export function __setCatalogCacheForTests(next) {
  cache = next && typeof next === "object"
    ? {
      models: next.models || {},
      providers: next.providers || {},
      costs: next.costs || {},
      lifecycle: next.lifecycle || {},
    }
    : EMPTY;
  cachedMtime = TEST_CACHE_MTIME;
}

// Hand the reader to capabilities.js. That module is bundled into the browser
// too, so it cannot import this file directly — the server pushes it in.
export async function installCatalogSource() {
  const { setCatalogSource } = await import("./capabilities.js");
  setCatalogSource({ getModalities: getCatalogModalities, getLimits: getCatalogLimits });
}
