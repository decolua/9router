// Embeddings provider adapter registry
import createOpenAIEmbeddingAdapter from "./openai.js";
import gemini from "./gemini.js";
import openaiCompatNode from "./openaiCompatNode.js";
import selfhostedEmbedding from "./selfhostedEmbedding.js";

const OPENAI_COMPAT_PROVIDERS = [
  "openai", "openrouter", "mistral", "voyage-ai", "fireworks",
  "together", "nebius", "github", "nvidia", "jina-ai",
  "vercel-ai-gateway",
];

const ADAPTERS = {
  ...Object.fromEntries(OPENAI_COMPAT_PROVIDERS.map((id) => [id, createOpenAIEmbeddingAdapter(id)])),
  gemini,
  google_ai_studio: gemini,
  // Self-hosted reads creds.providerSpecificData.baseUrl (one provider, many
  // servers) — but via its OWN adapter, not openaiCompatNode: that one falls back
  // to api.openai.com when no baseUrl is set, which under a provider called
  // "Self-hosted Embedding" means silently shipping the input and API key to
  // OpenAI. selfhostedEmbedding refuses instead.
  "selfhosted-embedding": selfhostedEmbedding,
};

export function getEmbeddingAdapter(provider) {
  if (ADAPTERS[provider]) return ADAPTERS[provider];
  if (provider?.startsWith?.("openai-compatible-") || provider?.startsWith?.("custom-embedding-")) {
    return openaiCompatNode;
  }
  return null;
}
