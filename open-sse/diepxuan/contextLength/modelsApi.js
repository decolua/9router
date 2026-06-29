/**
 * Provider /v1/models API fetcher.
 * Reads max_model_len from each provider's catalog endpoint.
 */

import { upsertContextLength, SOURCE_API } from "./cache.js";

const FETCH_TIMEOUT_MS = 8000;

// Provider-specific endpoints and response parsers.
// Each entry returns Promise<Array<{ modelId, contextLength }>>.
const PROVIDER_ENDPOINTS = {
  // NVIDIA NIM: no auth required for /v1/models
  nvidia: {
    url: "https://integrate.api.nvidia.com/v1/models",
    parse: (data) => {
      const models = data?.data || [];
      return models
        .filter((m) => m?.id && typeof m?.max_model_len === "number")
        .map((m) => ({
          modelId: `nvidia/${m.id}`,
          contextLength: m.max_model_len
        }));
    }
  },
  // OpenAI-compatible (Anthropic-compatible uses different schema, skip)
  // Add other providers here as needed
};

/**
 * Fetch context length from a provider's /v1/models endpoint.
 * @param {string} providerId - e.g. "nvidia"
 * @returns {Promise<number>} Number of models updated in cache
 */
export async function fetchProviderContextLengths(providerId) {
  const endpoint = PROVIDER_ENDPOINTS[providerId];
  if (!endpoint) return 0;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint.url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store"
    });
    clearTimeout(timeoutId);

    if (!response.ok) return 0;

    const data = await response.json();
    const parsed = endpoint.parse(data) || [];

    let count = 0;
    for (const { modelId, contextLength } of parsed) {
      upsertContextLength(modelId, contextLength, SOURCE_API);
      count++;
    }
    return count;
  } catch (err) {
    clearTimeout(timeoutId);
    return 0;
  }
}

/**
 * Live model resolver for /v1/models route.
 * Returns { models: [{ id, name?, contextLength? }] } | null.
 * @param {object} connection - Connection record from DB
 */
export async function resolveProviderModelsWithContext(connection) {
  if (!connection?.provider) return null;

  const providerId = connection.provider;
  if (!PROVIDER_ENDPOINTS[providerId]) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(PROVIDER_ENDPOINTS[providerId].url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store"
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const data = await response.json();
    const parsed = PROVIDER_ENDPOINTS[providerId].parse(data) || [];

    return {
      models: parsed.map((m) => ({
        id: m.modelId.replace(`${providerId}/`, ""),
        contextLength: m.contextLength
      }))
    };
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Check if provider has a supported /v1/models endpoint.
 */
export function hasProviderModelsApi(providerId) {
  return !!PROVIDER_ENDPOINTS[providerId];
}