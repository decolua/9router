const SVG_PROVIDER_ASSETS = new Set([
  "alicode",
  "alicode-intl",
  "assemblyai",
  "anthropic",
  "cerebras",
  "chutes",
  "claude",
  "cohere",
  "codex",
  "cursor",
  "droid",
  "edge-tts",
  "elevenlabs",
  "fireworks",
  "google-tts",
  "gemini",
  "gemini-cli",
  "deepgram",
  "deepseek",
  "groq",
  "hyperbolic",
  "kiro",
  "kimi-coding",
  "mistral",
  "nanobanana",
  "nvidia",
  "ollama",
  "ollama-local",
  "openai",
  "openrouter",
  "roo",
  "siliconflow",
  "together",
  "vertex",
  "vertex-partner",
  "xai",
  "kimi",
  "kilocode",
  "perplexity",
  "glm",
  "glm-cn",
]);

export function getProviderAssetPath(providerId) {
  if (!providerId) return "";

  const normalizedId = String(providerId).trim().toLowerCase();
  const extension = SVG_PROVIDER_ASSETS.has(normalizedId) ? "svg" : "png";

  return `/providers/${normalizedId}.${extension}`;
}
