import { AI_PROVIDERS } from "../shared/constants/providers.js";

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

  if (provider === "bedrock") {
    // accessKeyId: from providerSpecificData or top-level body
    const accessKeyId = (next.accessKeyId || body.accessKeyId || "").trim();
    if (accessKeyId) next.accessKeyId = accessKeyId;

    // region: default us-east-1
    const region = (next.region || body.region || "us-east-1").trim();
    if (region) next.region = region;

    // sessionToken (optional, for temporary STS credentials)
    const sessionToken = (next.sessionToken || body.sessionToken || "").trim();
    if (sessionToken) next.sessionToken = sessionToken;
  }

  return Object.keys(next).length > 0 ? next : null;
}
