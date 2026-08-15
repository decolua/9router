// Cached live catalog for the opencode free tier (oc/). opencode is a
// connection-less noAuth provider with no static model list, so bare-name
// resolution and /v1/models used to depend entirely on manually-added custom
// model rows — new upstream models stayed invisible until an admin added them.
// This module fetches the same catalog the dashboard's suggested-models flow
// uses and caches it briefly so resolution and listing stay current without
// admin data or a DB write.
import { FILTERS } from "@/app/api/providers/suggested-models/filters.js";

const CATALOG_URL = "https://opencode.ai/zen/v1/models";
const CACHE_TTL_MS = 10 * 60 * 1000;
// Resolution runs on the request path (bare model names) — bound the fetch so
// an unreachable opencode.ai delays the request by seconds, not the default
// multi-minute undici timeout.
const FETCH_TIMEOUT_MS = 5000;

let cached = null;
let cachedAt = 0;
let inflight = null;

async function doFetch() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(CATALOG_URL, { signal: controller.signal });
    if (!res.ok) return cached || [];
    const json = await res.json();
    const raw = json.data ?? json.models ?? json;
    const models = FILTERS["opencode-free"](Array.isArray(raw) ? raw : []);
    cached = models;
    cachedAt = Date.now();
    return models;
  } catch {
    return cached || [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCatalog() {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;
  if (!inflight) {
    inflight = doFetch();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }
  return inflight;
}

/**
 * Resolve a bare model id to the opencode free provider when the live catalog
 * serves it. Returns { provider: "opencode", model } or null.
 */
export async function lookupBareModel(modelStr) {
  const models = await fetchCatalog();
  const hit = models.find((m) => m && m.id === modelStr);
  if (hit) return { provider: "opencode", model: hit.id };
  // Catalog unreachable (network/timeout) or the id isn't listed yet. The
  // "-free" suffix is opencode's free-tier id convention (big-pickle is the one
  // exception), so keep owning those names instead of falling through to prefix
  // inference — which would blind-route e.g. deepseek-v4-flash-free to
  // openrouter and mimo-v2.5-free to openai (the "similar model" fallback).
  if (modelStr === "big-pickle" || String(modelStr).endsWith("-free")) {
    return { provider: "opencode", model: modelStr };
  }
  return null;
}

/**
 * Current opencode free catalog as [{ id, name }] entries, for /v1/models.
 */
export async function getListedModels() {
  return await fetchCatalog();
}
