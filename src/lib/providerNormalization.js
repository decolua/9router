import { AI_PROVIDERS } from "../shared/constants/providers.js";
import { API_MODE_DEFAULT, resolveApiMode } from "../../open-sse/config/apiModeConstants.js";

/**
 * Detect xAI Grok models by id pattern (grok-*, Grok_*, etc).
 * @param {string} modelId
 * @returns {boolean}
 */
export function isXaiModel(modelId) {
  return typeof modelId === "string" && /^grok[-_]/i.test(modelId.trim());
}

export function normalizeProviderId(provider) {
  if (typeof provider !== "string") return provider;

  const trimmed = provider.trim();
  if (AI_PROVIDERS[trimmed]) return trimmed;

  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  if (AI_PROVIDERS[slug]) return slug;

  const providerByName = Object.values(AI_PROVIDERS).find(
    (entry) => entry.name?.toLowerCase() === trimmed.toLowerCase()
  );
  return providerByName?.id || trimmed;
}

export function normalizeProviderSpecificData(provider, body = {}, providerSpecificData = null) {
  const next = providerSpecificData && typeof providerSpecificData === "object"
    ? { ...providerSpecificData }
    : {};

  if (provider === "ollama-local") {
    const baseUrl = (
      next.baseUrl ||
      body.baseUrl ||
      body.baseURL ||
      body.ollamaHostUrl ||
      ""
    ).trim();

    if (baseUrl) next.baseUrl = baseUrl;
  }

  // New connections of an apiModes provider always store an explicit mode (default
  // auto) — a missing value is reserved for pre-existing connections (legacy chat).
  if (AI_PROVIDERS[provider]?.apiModes && next.apiMode === undefined) next.apiMode = API_MODE_DEFAULT;
  sanitizeApiMode(provider, next);

  return Object.keys(next).length > 0 ? next : null;
}

/**
 * Keep `apiMode` only for providers that declare `apiModes`, coerced to a declared
 * value (unknown → "auto"). Mutates and returns `providerSpecificData`.
 * @param {string} provider
 * @param {object|null} providerSpecificData
 */
export function sanitizeApiMode(provider, providerSpecificData) {
  if (!providerSpecificData || typeof providerSpecificData !== "object") return providerSpecificData;
  if (!("apiMode" in providerSpecificData)) return providerSpecificData;
  const mode = resolveApiMode(AI_PROVIDERS[provider]?.apiModes, providerSpecificData.apiMode);
  if (mode) providerSpecificData.apiMode = mode;
  else delete providerSpecificData.apiMode;
  return providerSpecificData;
}
