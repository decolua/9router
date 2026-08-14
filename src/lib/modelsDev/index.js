// models.dev catalog service.
// Fetches https://models.dev/api.json, caches it in the kv store (scope
// "modelsDev") with a 24h TTL, and normalizes entries into 9router's internal
// caps/pricing shapes. Falls back to a stale cached catalog when the network
// fetch fails.

import { makeKv } from "../db/helpers/kvStore.js";
import { resolveModelsDevProviderId } from "./providerMap.js";

export const MODELS_DEV_URL = "https://models.dev/api.json";
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const kv = makeKv("modelsDev");

let memCache = { catalog: null, fetchedAt: 0 };

async function readStoredCatalog() {
  if (memCache.catalog) return memCache;
  const [catalog, fetchedAt] = await Promise.all([kv.get("catalog"), kv.get("fetchedAt")]);
  if (catalog && fetchedAt) {
    memCache = { catalog, fetchedAt };
  }
  return memCache;
}

/**
 * Get the models.dev catalog, refreshing when stale (24h TTL) or forced.
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<{ catalog: object, fetchedAt: number, stale: boolean }>}
 */
export async function getCatalog({ forceRefresh = false } = {}) {
  const now = Date.now();

  if (!forceRefresh) {
    const stored = await readStoredCatalog();
    if (stored.catalog && now - stored.fetchedAt < CATALOG_TTL_MS) {
      return { catalog: stored.catalog, fetchedAt: stored.fetchedAt, stale: false };
    }
  }

  try {
    const res = await fetch(MODELS_DEV_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`models.dev responded ${res.status}`);
    const catalog = await res.json();
    const fetchedAt = Date.now();
    await kv.setMany({ catalog, fetchedAt });
    memCache = { catalog, fetchedAt };
    return { catalog, fetchedAt, stale: false };
  } catch (error) {
    // Network failure — serve the stale cached catalog when available.
    const stored = await readStoredCatalog();
    if (stored.catalog) {
      return { catalog: stored.catalog, fetchedAt: stored.fetchedAt, stale: true };
    }
    throw error;
  }
}

/**
 * Normalize a raw models.dev model entry into 9router shapes.
 * caps field names mirror open-sse/providers/capabilities.js; pricing field
 * names mirror open-sse/providers/pricing.js ($ per 1M tokens).
 * @param {object} entry - raw models.dev model object
 * @returns {{ id: string, name: string, family: string|null, releaseDate: string|null, lastUpdated: string|null, caps: object, pricing: object|null }|null}
 */
export function normalizeModel(entry) {
  if (!entry || typeof entry !== "object" || !entry.id) return null;

  const input = Array.isArray(entry.modalities?.input) ? entry.modalities.input : [];
  const output = Array.isArray(entry.modalities?.output) ? entry.modalities.output : [];
  const limit = entry.limit || {};

  const caps = {
    vision: input.includes("image"),
    pdf: input.includes("pdf"),
    audioInput: input.includes("audio"),
    videoInput: input.includes("video"),
    imageOutput: output.includes("image"),
    audioOutput: output.includes("audio"),
    reasoning: entry.reasoning === true,
  };
  // Only override static capabilities when models.dev explicitly reports tool
  // support — an absent tool_call must not clobber an existing `tools: false`.
  if (typeof entry.tool_call === "boolean") caps.tools = entry.tool_call;
  if (typeof limit.context === "number") caps.contextWindow = limit.context;
  if (typeof limit.output === "number") caps.maxOutput = limit.output;

  let pricing = null;
  if (entry.cost && typeof entry.cost === "object") {
    pricing = {};
    if (typeof entry.cost.input === "number") pricing.input = entry.cost.input;
    if (typeof entry.cost.output === "number") pricing.output = entry.cost.output;
    if (typeof entry.cost.cache_read === "number") pricing.cached = entry.cost.cache_read;
    if (typeof entry.cost.cache_write === "number") pricing.cache_creation = entry.cost.cache_write;
    if (Object.keys(pricing).length === 0) pricing = null;
  }

  return {
    id: entry.id,
    name: entry.name || entry.id,
    family: entry.family || null,
    releaseDate: entry.release_date || null,
    lastUpdated: entry.last_updated || null,
    caps,
    pricing,
  };
}

/**
 * Get normalized models.dev data for a 9router provider.
 * @param {string|string[]} providerKeys - 9router provider id and/or alias (tried in order)
 * @param {{ forceRefresh?: boolean }} [options]
 * @returns {Promise<{ modelsDevId: string|null, providerName: string|null, models: object|null, fetchedAt: number, stale: boolean }>}
 */
export async function getProviderModels(providerKeys, options = {}) {
  const { catalog, fetchedAt, stale } = await getCatalog(options);
  const catalogIds = Object.keys(catalog);
  const keys = (Array.isArray(providerKeys) ? providerKeys : [providerKeys]).filter(Boolean);

  let modelsDevId = null;
  for (const key of keys) {
    modelsDevId = resolveModelsDevProviderId(key, catalogIds);
    if (modelsDevId) break;
  }
  if (!modelsDevId) {
    return { modelsDevId: null, providerName: null, models: null, fetchedAt, stale };
  }

  const providerEntry = catalog[modelsDevId] || {};
  const rawModels = providerEntry.models || {};
  const models = {};
  for (const [id, entry] of Object.entries(rawModels)) {
    const normalized = normalizeModel({ id, ...entry });
    if (normalized) models[id] = normalized;
  }

  return {
    modelsDevId,
    providerName: providerEntry.name || modelsDevId,
    models,
    fetchedAt,
    stale,
  };
}

/** Test hook: drop the in-memory cache. */
export function __resetCacheForTests() {
  memCache = { catalog: null, fetchedAt: 0 };
}
