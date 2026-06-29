/**
 * Public API for context length lookups.
 * Combines: cache → provider API → static MODEL_INFO.
 */

import { getCachedContextLength, getCachedContextLengthBatch, upsertContextLength, initContextLengthCache, SOURCE_STATIC } from "./cache.js";
import { fetchProviderContextLengths, hasProviderModelsApi } from "./modelsApi.js";
import { extractContextLengthFromError, updateContextLengthFromError } from "./errorParser.js";

let initialized = false;

/**
 * Lazy initialization on first use.
 */
function ensureInit() {
  if (initialized) return;
  try {
    initContextLengthCache();
    initialized = true;
  } catch (err) {
    console.warn("[ContextLength] Failed to init cache:", err?.message || err);
  }
}

/**
 * Get context length for a single model.
 * Resolution order: cache (api/error) → live API fetch → MODEL_INFO static.
 * @param {string} modelId - Full model ID, e.g. "nvidia/minimaxai/minimax-m2.7"
 * @returns {Promise<{contextLength: number, source: string}|null>}
 */
export async function getContextLength(modelId) {
  ensureInit();
  if (!modelId) return null;

  // 1. Cache hit
  const cached = getCachedContextLength(modelId);
  if (cached) return cached;

  // 2. Extract provider prefix
  const slashIdx = modelId.indexOf("/");
  const providerId = slashIdx > 0 ? modelId.slice(0, slashIdx) : null;
  if (!providerId || !hasProviderModelsApi(providerId)) return null;

  // 3. Live API fetch (sync wait, low timeout)
  await fetchProviderContextLengths(providerId);

  // 4. Re-check cache after fetch
  return getCachedContextLength(modelId);
}

/**
 * Batch lookup. Synchronous, reads only from cache.
 * @param {string[]} modelIds
 * @returns {Map<string, {contextLength: number, source: string}>}
 */
export function getContextLengthBatchCached(modelIds) {
  ensureInit();
  return getCachedContextLengthBatch(modelIds || []);
}

/**
 * Static fallback values. Used when cache + API are both unavailable.
 * Keyed by full model ID.
 */
const MODEL_INFO = {
  // NVIDIA NIM
  "minimaxai/minimax-m2.7": 204800,
  "minimaxai/minimax-m3": 1024000,
  "deepseek-ai/deepseek-v4-pro": 1048576,
  "deepseek-ai/deepseek-v4-flash": 262144,
  "moonshotai/kimi-k2.6": 262144,
  "qwen/qwen3.5-397b-a17b": 262144,
  "qwen/qwen3.5-122b-a10b": 262144,
  "qwen/qwen3-coder-480b-a35b-instruct": 262144,
  "z-ai/glm-5.1": 200000,
  "mistralai/mistral-medium-3.5-128b": 128000,
  "mistralai/mistral-large-3-675b-instruct-2512": 128000,
  "nvidia/llama-3.3-nemotron-super-49b-v1": 131072,
  "nvidia/llama-3.3-nemotron-super-49b-v1.5": 131072,
  "nvidia/nemotron-3-super-120b-a12b": 1048576,
  "nvidia/nemotron-3-ultra-550b-a55b": 1048576,
  "google/gemma-4-31b-it": 32768
};

/**
 * Get static fallback context length for a model.
 * Tries both full ID and suffix match.
 * @param {string} modelId
 * @returns {number|null}
 */
export function getStaticContextLength(modelId) {
  if (!modelId) return null;

  // Direct hit
  if (MODEL_INFO[modelId]) {
    upsertContextLength(modelId, MODEL_INFO[modelId], SOURCE_STATIC);
    return MODEL_INFO[modelId];
  }

  // Suffix match (e.g. "nvidia/minimaxai/minimax-m2.7" -> look up "minimaxai/minimax-m2.7")
  const slashIdx = modelId.indexOf("/");
  if (slashIdx > 0) {
    const suffix = modelId.slice(slashIdx + 1);
    if (MODEL_INFO[suffix]) {
      upsertContextLength(modelId, MODEL_INFO[suffix], SOURCE_STATIC);
      return MODEL_INFO[suffix];
    }
  }

  return null;
}

/**
 * Get context length with all fallbacks applied.
 * Tries cache, then static MODEL_INFO (sync, always available).
 * For async API fetch, callers should trigger `getContextLength()` separately.
 * @param {string} modelId
 * @returns {number|null}
 */
export function getContextLengthSync(modelId) {
  ensureInit();
  if (!modelId) return null;

  // 1. Cache hit
  const cached = getCachedContextLength(modelId);
  if (cached) return cached.contextLength;

  // 2. Static fallback
  return getStaticContextLength(modelId);
}

export {
  fetchProviderContextLengths,
  extractContextLengthFromError,
  updateContextLengthFromError,
  hasProviderModelsApi
};