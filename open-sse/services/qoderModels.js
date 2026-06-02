/**
 * Qoder model catalog fetcher.
 *
 * Calls /algo/api/v2/model/list (COSY-signed) on the inference host to get
 * the live catalog for an authenticated Qoder account, then caches the
 * per-model `model_config` blocks by key. Chat requests later look up the
 * exact server-published metadata for the model they want — Qoder's chat
 * endpoint silently downgrades to a different model when the wrong
 * model_config is sent.
 *
 * On any error the live cache stays empty and chatExecuteCall surfaces the
 * problem to the user as "model config not yet fetched, retry shortly".
 */

import { createHash } from "crypto";

import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { buildCosyHeaders } from "@/lib/qoder/cosy.js";
import {
  QODER_MODEL_ALIASES,
  QODER_MODEL_LIST_URL,
  QODER_MODEL_MAP,
} from "@/lib/qoder/constants.js";

/** Normalize model keys for fuzzy catalog matching (qwen3.7-max ≈ qwen37max). */
function normalizeModelKey(key) {
  return String(key || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Resolve user input to canonical Qoder model key. */
export function canonicalQoderModelKey(modelKey) {
  const raw = String(modelKey || "").replace(/^qoder\//, "").trim();
  if (!raw) return raw;
  if (QODER_MODEL_MAP[raw]) return raw;
  if (QODER_MODEL_ALIASES[raw]) return QODER_MODEL_ALIASES[raw];
  const norm = normalizeModelKey(raw);
  for (const [alias, canonical] of Object.entries(QODER_MODEL_ALIASES)) {
    if (normalizeModelKey(alias) === norm) return canonical;
  }
  for (const key of Object.keys(QODER_MODEL_MAP)) {
    if (normalizeModelKey(key) === norm) return key;
  }
  return raw;
}

function findCatalogEntry(rawConfigs, modelKey) {
  if (!rawConfigs || !modelKey) return null;
  if (rawConfigs.has(modelKey)) {
    return { entry: rawConfigs.get(modelKey), catalogKey: modelKey };
  }
  const norm = normalizeModelKey(modelKey);
  for (const [k, entry] of rawConfigs) {
    if (normalizeModelKey(k) === norm) return { entry, catalogKey: k };
  }
  return null;
}

/** Minimal model_config when catalog fetch misses a statically-known model. */
export function buildFallbackQoderModelConfig(modelKey) {
  const key = canonicalQoderModelKey(modelKey);
  const isQwen37 = /^qwen37max$/i.test(normalizeModelKey(key));
  return {
    key,
    enable: true,
    display_name: key,
    max_input_tokens: 131_072,
    max_output_tokens: 32_768,
    is_reasoning: isQwen37,
    is_vl: false,
    source: "system",
  };
}

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
 * Strip credential -> COSY creds for buildCosyHeaders.
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
 * Fetch the live model list for this credential. Returns:
 *   { models: [{ id, name, contextLength, isVL, isReasoning, ... }, ...],
 *     rawConfigs: Map<modelKey, modelConfigObject> }
 * or `null` on any error.
 */
async function fetchQoderCatalogRaw(credentials, signal, proxyOptions = null) {
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
      // If the parent signal already aborted before we got here, the
      // 'abort' event has already fired and addEventListener won't
      // re-trigger it. Propagate the cancellation immediately.
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

    // Always cache the config — chat needs model_config even for UI-hidden
    // models (enable:false). Upstream still accepts chat for these keys.
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
 * Get the cached model_config block for a given model key, fetching the
 * catalog first if needed. Returns null when the catalog can't be fetched
 * (so callers can fall back to the static registry).
 */
export async function getQoderModelConfig(credentials, modelKey, options = {}) {
  const resolved = await resolveQoderModelConfig(credentials, modelKey, options);
  return resolved?.modelConfig ?? null;
}

/**
 * Resolve model_config for chat: live catalog first, then static/fallback config.
 */
export async function resolveQoderModelConfig(credentials, modelKey, options = {}) {
  const qoderKey = canonicalQoderModelKey(modelKey);
  if (!qoderKey) return null;

  let catalog = await resolveQoderModels(credentials, options);
  let found = catalog ? findCatalogEntry(catalog.rawConfigs, qoderKey) : null;

  if (!found && !options.forceRefresh) {
    catalog = await resolveQoderModels(credentials, { ...options, forceRefresh: true });
    found = catalog ? findCatalogEntry(catalog.rawConfigs, qoderKey) : null;
  }

  if (found) {
    const upstreamKey = found.catalogKey;
    return { qoderKey: upstreamKey, modelConfig: { ...found.entry, key: upstreamKey } };
  }

  if (QODER_MODEL_MAP[qoderKey]) {
    return { qoderKey, modelConfig: buildFallbackQoderModelConfig(qoderKey) };
  }

  return null;
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

/**
 * Check if a model key is supported. Allows both static (QODER_MODEL_MAP)
 * and dynamically-discovered models from the upstream catalog.
 */
export function isKnownQoderModel(qoderKey) {
  const canonical = canonicalQoderModelKey(qoderKey);
  if (QODER_MODEL_MAP[canonical]) return true;
  for (const entry of catalogCache.values()) {
    if (findCatalogEntry(entry.rawConfigs, canonical)?.entry) return true;
  }
  return false;
}

/**
 * Get all known model keys (static + dynamic).
 */
export function getAllKnownQoderModels() {
  const keys = new Set(Object.keys(QODER_MODEL_MAP));
  for (const entry of catalogCache.values()) {
    for (const key of entry.rawConfigs.keys()) {
      keys.add(key);
    }
  }
  return keys;
}

export function clearQoderCatalog() {
  catalogCache.clear();
}
