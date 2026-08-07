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

  // NVIDIA multi-service provider (LLM + TTS + Embedding)
  if (provider === "nvidia") {
    if (!next.ttsConfig) {
      next.ttsConfig = {
        baseUrl: "https://integrate.api.nvidia.com/v1/audio/speech",
        authType: "apikey",
        authHeader: "bearer",
        format: "nvidia-tts",
      };
    }
    if (!next.embeddingConfig) {
      next.embeddingConfig = {
        baseUrl: "https://integrate.api.nvidia.com/v1/embeddings",
        authType: "apikey",
        authHeader: "bearer",
      };
    }
    if (!next.serviceKinds) {
      next.serviceKinds = ["llm", "tts", "embedding"];
    }
  }

  return Object.keys(next).length > 0 ? next : null;
}
