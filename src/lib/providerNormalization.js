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

  // AutoClaw: when importing an access_token as an API key, decode the JWT
  // to extract device_id (needed for token refresh) and source_id. The JWT
  // payload carries { user_id, device_id, source_id, jti, exp }.
  if (provider === "autoclaw" && !next.deviceId) {
    const token = (body.apiKey || "").replace(/^Bearer\s+/i, "");
    if (token && token.split(".").length === 3) {
      try {
        const payload = token.split(".")[1];
        const json = JSON.parse(
          Buffer.from(payload + "=".repeat(-payload.length % 4), "base64url").toString("utf8")
        );
        next.deviceId = json.device_id || "";
        next.sourceId = "autoclaw";
      } catch {
        // Not a valid JWT — leave providerSpecificData as-is.
      }
    }
  }

  return Object.keys(next).length > 0 ? next : null;
}
