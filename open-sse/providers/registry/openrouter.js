export default {
  id: "openrouter",
  priority: 10,
  hasFree: true,
  alias: "openrouter",
  display: {
    name: "OpenRouter",
    icon: "router",
    color: "#F97316",
    textIcon: "OR",
    website: "https://openrouter.ai",
    notice: {
      text: "Free tier: 27+ free models, no credit card needed, 200 req/day. After  0 credit: 1,000 req/day.",
      apiKeyUrl: "https://openrouter.ai/settings/keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    thinkingFormat: "openai",
    // Key metadata endpoint: credit limit/remaining for the API key
    // ({limit, limit_remaining, limit_reset, usage_*} — limit null = uncapped).
    usage: {
      url: "https://openrouter.ai/api/v1/key",
    },
    // Chat traffic is attributed to the real calling client (X-Title + forwarded
    // User-Agent) by the openrouterAttribution header hook, not a hardcoded brand.
    auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["openrouterAttribution"] },
  },
  // Multi-endpoint: OpenRouter's Anthropic-compatible /v1/messages accepts any
  // catalog model, so claude-format clients route there with zero translation
  // (sourceFormat-matched transport, see chatCore). thinkingFormat is per-wire:
  // the default transport keeps OpenAI reasoning_effort; this one speaks native
  // Anthropic thinking. Auth stays Bearer (OpenRouter's skin, not x-api-key).
  transports: [
    {
      format: "claude",
      baseUrl: "https://openrouter.ai/api/v1/messages",
      thinkingFormat: "claude-budget",
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["openrouterAttribution"] },
    },
  ],
  models: [
    { id: "openai/text-embedding-3-large", name: "OpenAI Text Embedding 3 Large", kind: "embedding" },
    { id: "openai/text-embedding-3-small", name: "OpenAI Text Embedding 3 Small", kind: "embedding" },
    { id: "openai/text-embedding-ada-002", name: "OpenAI Text Embedding Ada 002", kind: "embedding" },
    { id: "qwen/qwen3-embedding-8b", name: "Qwen3 Embedding 8B", kind: "embedding" },
    { id: "perplexity/pplx-embed-v1-4b", name: "Perplexity Embed V1 4B", kind: "embedding" },
    { id: "perplexity/pplx-embed-v1-0.6b", name: "Perplexity Embed V1 0.6B", kind: "embedding" },
    { id: "nvidia/llama-nemotron-embed-vl-1b-v2:free", name: "NVIDIA Nemotron Embed VL 1B V2 (Free)", kind: "embedding" },
    { id: "openai/gpt-4o-mini-tts", name: "GPT-4o Mini TTS", kind: "tts" },
    { id: "openai/tts-1-hd", name: "TTS-1 HD", kind: "tts" },
    { id: "openai/tts-1", name: "TTS-1", kind: "tts" },
    { id: "openai/dall-e-3", name: "DALL-E 3 (via OpenRouter)", params: ["size","quality","style","response_format"], kind: "image" },
    { id: "openai/gpt-image-1", name: "GPT Image 1 (via OpenRouter)", params: ["n","size","quality","response_format"], kind: "image" },
    { id: "google/imagen-3.0-generate-002", name: "Imagen 3 (via OpenRouter)", params: ["n","size"], kind: "image" },
    { id: "black-forest-labs/FLUX.1-schnell", name: "FLUX.1 Schnell (via OpenRouter)", params: ["n","size"], kind: "image" },
  ],
  serviceKinds: ["llm","embedding","tts","imageToText"],
  ttsConfig: {
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini-tts",
    headers: {"HTTP-Referer":"https://endpoint-proxy.local","X-Title":"Endpoint Proxy"},
  },
  embeddingConfig: {
    baseUrl: "https://openrouter.ai/api/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
    headers: {"HTTP-Referer":"https://endpoint-proxy.local","X-Title":"Endpoint Proxy"},
  },
  imageConfig: {
    baseUrl: "https://openrouter.ai/api/v1/images/generations",
    headers: {"HTTP-Referer":"https://endpoint-proxy.local","X-Title":"Endpoint Proxy"},
  },
  modelsFetcher: { url: "https://openrouter.ai/api/v1/models", type: "openrouter-free" },
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};
