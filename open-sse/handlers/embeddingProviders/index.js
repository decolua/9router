// Embeddings provider adapter registry
import createOpenAIEmbeddingAdapter from "./openai.js";
import gemini from "./gemini.js";
import openaiCompatNode from "./openaiCompatNode.js";

const OPENAI_COMPAT_PROVIDERS = [
  "openai", "openrouter", "mistral", "voyage-ai", "fireworks",
  "together", "nebius", "github", "nvidia", "jina-ai",
];

const ADAPTERS = {
  ...Object.fromEntries(OPENAI_COMPAT_PROVIDERS.map((id) => [id, createOpenAIEmbeddingAdapter(id)])),
  gemini,
  google_ai_studio: gemini,
};

export function getEmbeddingAdapter(provider) {
  if (ADAPTERS[provider]) return ADAPTERS[provider];
  if (provider?.startsWith?.("openai-compatible-") || provider?.startsWith?.("custom-embedding-")) {
    return openaiCompatNode;
  }
  return null;
}
