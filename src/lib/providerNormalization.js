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

  return Object.keys(next).length > 0 ? next : null;
}

/**
 * Prefix a per-connection `defaultModel` with the provider's namespace prefix
 * when the upstream namespace is required. Compatible providers return models
 * like `zm/glm-5.2-free`; without the prefix the model is sent as `glm-5.2-free`
 * to the gateway and rejected as unknown.
 */
export function normalizeDefaultModel(prefix, model) {
  if (typeof model !== "string" || !model.trim()) return model || null;
  const trimmed = model.trim();
  if (typeof prefix !== "string" || !prefix.trim()) return trimmed;
  const p = prefix.trim();
  if (trimmed === p || trimmed.startsWith(p + "/")) return trimmed;
  return `${p}/${trimmed}`;
}
