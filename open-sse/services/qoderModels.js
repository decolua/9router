/**
 * Qoder model catalog fetcher.
 *
 * Tries the new api2-v2.qoder.sh/model/v1/models endpoint first (simple Bearer
 * auth, standard OpenAI model list format). Falls back to the legacy
 * api3.qoder.sh/algo/api/v2/model/list endpoint (COSY-signed) if the new one
 * fails.
 *
 * Caches the per-model `model_config` blocks by key. Chat requests use the
 * max_output_tokens from model_config as the default max_tokens — but the new
 * api2-v2 chat endpoint doesn't require model_config in the request body
 * (unlike the old COSY endpoint which silently downgraded models).
 *
 * On any error the live cache stays empty and the executor falls back to
 * default max_tokens=32768.
 */

import { createHash } from "crypto";

import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { buildCosyHeaders } from "../shared/qoder/cosy.js";
import {
  QODER_MODEL_LIST_URL,
  QODER_MODEL_LIST_URL_V2,
} from "../shared/qoder/constants.js";

const FETCH_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h, same as the Kiro catalog

/** @type {Map<string, { expiresAt: number, models: any[], rawConfigs: Map<string, object>, fetched: boolean }>} */
const catalogCache = new Map();

/**
 * In-flight fetch promises keyed by cacheKey. Concurrent first-time
 * callers (parallel chat windows) all observe the same Promise so we
 * fan-out exactly one upstream request per credential per miss.
 * @type {Map<string, Promise<{ expiresAt: number, models: any[], rawConfigs: Map<string, object>, fetched: boolean } | null>>}
 */
const inflight = new Map();

/**
 * Stable cache key per credential (so different login sessions for the same
 * account share an entry).
 */
function cacheKey(credentials) {
  const psd = credentials?.providerSpecificData || {};
  const seed = psd.userId || credentials?.refreshToken || credentials?.accessToken || "anonymous";
  return createHash("sha256").update(`qoder:${seed}`).digest("hex");
}

/**
 * Strip credential -> COSY creds for buildCosyHeaders (legacy fallback only).
 */
function cosyCredsFromConnection(credentials) {
  const psd = credentials?.providerSpecificData || {};
  return {
    userId: psd.userId,
    authToken: credentials.accessToken,
    name: credentials.displayName || "",
    email: credentials.email || "",
    machineId: psd.machineId || "",
  };
}

/**
 * Fetch model list from the NEW api2-v2 endpoint (Bearer auth, standard
 * OpenAI model list format). Returns { models, rawConfigs } or null on error.
 *
 * The new endpoint likely returns a simpler list. We try to normalize it
 * into the same shape as the legacy endpoint's `chat` array.
 */
async function fetchQoderCatalogV2(credentials, signal, proxyOptions = null) {
  if (!credentials?.accessToken) return null;

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${credentials.accessToken}`,
    "User-Agent": "qoder/1.1.11",
  };

  const controller = new AbortController();
  let timer = null;
  let abortListener = null;
  let response;
  try {
    timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
    if (signal && typeof signal.addEventListener === "function") {
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        abortListener = () => controller.abort(signal.reason);
        signal.addEventListener("abort", abortListener);
      }
    }
    response = await proxyAwareFetch(
      QODER_MODEL_LIST_URL_V2,
      {
        method: "GET",
        headers,
        signal: controller.signal,
      },
      proxyOptions,
    );
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }

  if (!response.ok) return null;

  const body = await response.json().catch(() => null);
  if (!body) return null;

  // The new endpoint may return either:
  // 1. { data: [{ id, ... }, ...] } — standard OpenAI /v1/models format
  // 2. { chat: [{ key, ... }, ...] } — same as the legacy endpoint
  // 3. [{ id, ... }, ...] — bare array
  // Normalize all into the legacy { chat: [...] } shape.
  let entries;
  if (Array.isArray(body)) {
    entries = body;
  } else if (Array.isArray(body.data)) {
    entries = body.data;
  } else if (Array.isArray(body.chat)) {
    entries = body.chat;
  } else if (body.models && Array.isArray(body.models)) {
    entries = body.models;
  } else {
    return null;
  }

  const models = [];
  const rawConfigs = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    // The new endpoint uses "id"; the legacy uses "key". Support both.
    const key = entry.key || entry.id;
    if (!key) continue;

    rawConfigs.set(key, entry);
    if (entry.enable === false) continue;

    const display = entry.display_name || entry.name || key;
    const ctx = Number(entry.max_input_tokens || entry.context_length) || 131_072;
    models.push({
      id: key,
      name: `${display}`,
      contextLength: ctx,
      isVL: !!entry.is_vl,
      isReasoning: !!entry.is_reasoning,
      maxOutputTokens: Number(entry.max_output_tokens) || 0,
      description: entry.description || "",
    });
  }

  if (models.length === 0 && rawConfigs.size === 0) return null;
  return { models, rawConfigs };
}

/**
 * Fetch model list from the LEGACY api3 endpoint (COSY-signed). Returns
 * { models, rawConfigs } or null on error. Used as fallback when the new
 * endpoint fails.
 */
async function fetchQoderCatalogLegacy(credentials, signal, proxyOptions = null) {
  const creds = cosyCredsFromConnection(credentials);
  if (!creds.userId || !creds.authToken) return null;

  const headers = {
    Accept: "application/json",
    "Accept-Encoding": "identity",
    ...buildCosyHeaders(Buffer.alloc(0), QODER_MODEL_LIST_URL, creds),
  };

  const controller = new AbortController();
  let timer = null;
  let abortListener = null;
  let response;
  try {
    timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
    if (signal && typeof signal.addEventListener === "function") {
      if (signal.aborted) {
        controller.abort(signal.reason);
      } else {
        abortListener = () => controller.abort(signal.reason);
        signal.addEventListener("abort", abortListener);
      }
    }
    response = await proxyAwareFetch(
      QODER_MODEL_LIST_URL,
      {
        method: "GET",
        headers,
        signal: controller.signal,
      },
      proxyOptions,
    );
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && abortListener) signal.removeEventListener("abort", abortListener);
  }

  if (!response.ok) return null;

  const body = await response.json().catch(() => null);
  if (!body || !Array.isArray(body.chat)) return null;

  const models = [];
  const rawConfigs = new Map();
  for (const entry of body.chat) {
    if (!entry || typeof entry !== "object") continue;
    const key = entry.key;
    if (!key) continue;

    rawConfigs.set(key, entry);
    if (entry.enable === false) continue;

    const display = entry.display_name || key;
    const ctx = Number(entry.max_input_tokens) || 131_072;
    models.push({
      id: key,
      name: `${display}`,
      contextLength: ctx,
      isVL: !!entry.is_vl,
      isReasoning: !!entry.is_reasoning,
      maxOutputTokens: Number(entry.max_output_tokens) || 0,
      description: entry.description || "",
    });
  }

  return { models, rawConfigs };
}

/**
 * Fetch the live model list, trying the new V2 endpoint first, then falling
 * back to the legacy COSY-signed endpoint.
 */
async function fetchQoderCatalogRaw(credentials, signal, proxyOptions = null) {
  // Try new endpoint first (simple Bearer auth).
  const v2Result = await fetchQoderCatalogV2(credentials, signal, proxyOptions);
  if (v2Result) return v2Result;

  // Fall back to legacy endpoint (COSY-signed).
  const legacyResult = await fetchQoderCatalogLegacy(credentials, signal, proxyOptions);
  return legacyResult;
}

/**
 * Get the cached model_config block for a given model key, fetching the
 * catalog first if needed. Returns null when the catalog can't be fetched
 * (so callers can fall back to defaults — the new endpoint doesn't require
 * model_config in the request body).
 */
export async function getQoderModelConfig(credentials, modelKey, options = {}) {
  const cached = await resolveQoderModels(credentials, options);
  if (!cached) return null;
  const config = cached.rawConfigs.get(modelKey);
  if (!config) return null;
  // Defensive copy — chat code may mutate `key` to align with the alias path.
  return { ...config, key: modelKey };
}

/**
 * Resolve the live model catalog + raw configs for a credential. Caches
 * results for CACHE_TTL_MS so repeated chat requests don't re-fetch, and
 * deduplicates concurrent misses so parallel chat windows fan-out exactly
 * one upstream request per credential.
 */
export async function resolveQoderModels(credentials, options = {}) {
  if (!credentials?.accessToken) return null;
  const psd = credentials.providerSpecificData || {};
  if (!psd.userId) return null;

  const key = cacheKey(credentials);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached;
    }
  }

  // Coalesce concurrent misses on the same credential into one upstream call.
  // forceRefresh callers still get their own fetch (they wanted fresh data).
  const existing = inflight.get(key);
  if (existing && !options.forceRefresh) {
    return existing;
  }

  const fetchPromise = (async () => {
    const fetched = await fetchQoderCatalogRaw(credentials, options.signal, options.proxyOptions);
    if (!fetched) return null;
    const entry = {
      expiresAt: Date.now() + CACHE_TTL_MS,
      models: fetched.models,
      rawConfigs: fetched.rawConfigs,
      fetched: true,
    };
    catalogCache.set(key, entry);
    return entry;
  })();

  inflight.set(key, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    // Clear only if this is still the in-flight entry — a forceRefresh
    // call that started later may have replaced it.
    if (inflight.get(key) === fetchPromise) {
      inflight.delete(key);
    }
  }
}

export function invalidateQoderCatalog(credentials) {
  if (!credentials) return;
  catalogCache.delete(cacheKey(credentials));
}

export function clearQoderCatalog() {
  catalogCache.clear();
}
