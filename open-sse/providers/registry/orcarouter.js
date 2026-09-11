// OrcaRouter — OpenAI-compatible gateway (https://www.orcarouter.ai, docs: https://docs.orcarouter.ai).
// One endpoint at https://api.orcarouter.ai/v1 routing to OpenAI, Anthropic, Google, DeepSeek,
// xAI, Qwen, Moonshot Kimi, MiniMax, Z.ai (GLM) at provider cost price; models are addressed by
// provider-prefixed ids (e.g. "anthropic/claude-opus-4.8") plus orcarouter/* router ids.
// Also exposes /v1/responses (OpenAI Responses), /v1/images/generations, /v1/audio/speech,
// /v1/embeddings and native Anthropic/Gemini surfaces — all behind the same Bearer key.
// NOTE: /v1/models is public (no auth), so key validation passes trivially — real auth errors
// surface on the first chat request.
export default {
  id: "orcarouter",
  alias: "orcarouter",
  aliases: ["orca"],
  uiAlias: "orcarouter",
  hasFree: true,
  category: "apikey",
  display: {
    name: "OrcaRouter",
    icon: "sailing",
    color: "#0284C7",
    textIcon: "ORC",
    website: "https://www.orcarouter.ai",
    notice: {
      text: "OpenAI-compatible gateway. OpenAI, Anthropic, Google, DeepSeek, Qwen, Kimi, GLM, MiniMax & more at provider cost price. orcarouter/free routes to $0 models. Note: /v1/models is public so the key is not verified on save — an invalid key fails on the first chat request.",
      apiKeyUrl: "https://www.orcarouter.ai/console",
    },
  },
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.orcarouter.ai/v1/chat/completions",
    validateUrl: "https://api.orcarouter.ai/v1/models",
    // Every id takes OpenAI-shape reasoning_effort (docs.orcarouter.ai/advanced/reasoning),
    // so pin the provider-level thinking format like venice/vercel-ai-gateway do —
    // otherwise prefixed ids fall through to native family wire formats.
    thinkingFormat: "openai",
  },
  // Seed snapshot from the live /v1/models + /api/pricing catalogs — current-gen
  // ids only (GPT 5.6 series kept; dated variants, superseded families and
  // rolling aliases are NOT enabled by default). The full catalogue is fetched
  // via modelsFetcher; other ids still accepted via passthroughModels.
  models: [
    // orcarouter routers (auto-model selection / free routing)
    { id: "orcarouter/free", name: "Orca Free" },
    { id: "orcarouter/fusion", name: "Orca Fusion" },
    { id: "orcarouter/fusion-flash", name: "Orca Fusion Flash" },
    { id: "orcarouter/fusion-mini", name: "Orca Fusion Mini" },
    // $0 free pool that orcarouter/free routes into (model_ratio 0 in /api/pricing)
    { id: "deepseek/deepseek-v4-flash-free", name: "DeepSeek V4 Flash (Free)" },
    { id: "z-ai/glm-5.3-flash-free", name: "GLM 5.3 Flash (Free)" },
    { id: "tencent/hy3-free", name: "Tencent Hy3 (Free)" },
    // anthropic/
    { id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
    { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { id: "anthropic/claude-fable-5.1", name: "Claude Fable 5.1" },
    // openai/
    { id: "openai/gpt-6-astra", name: "GPT-6 Astra" },
    { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "openai/gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "openai/gpt-image-1.5", name: "GPT Image 1.5", kind: "image", params: ["n", "size", "quality"] },
    { id: "openai/gpt-image-1-mini", name: "GPT Image 1 Mini", kind: "image", params: ["n", "size"] },
    { id: "openai/gpt-4o-mini-tts", name: "GPT-4o Mini TTS", kind: "tts" },
    // google/
    { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash" },
    { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "google/gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "google/gemini-3-pro-image-preview", name: "Nano Banana Pro (Gemini 3 Pro Image)", kind: "image" },
    { id: "google/imagen-4.0-generate-001", name: "Imagen 4", kind: "image", params: ["n", "size"] },
    { id: "google/gemini-embedding-001", name: "Gemini Embedding 001", kind: "embedding" },
    // deepseek/
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    // legacy OpenAI alias ids — resolve to V4-Flash on OrcaRouter (see capabilities)
    { id: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
    { id: "deepseek/deepseek-reasoner", name: "DeepSeek Reasoner" },
    // qwen/
    { id: "qwen/qwen3.8-max", name: "Qwen3.8 Max" },
    { id: "qwen/qwen3.8-flash", name: "Qwen3.8 Flash" },
    { id: "qwen/qwen3-vl-235b-a22b-thinking", name: "Qwen3 VL 235B A22B Thinking" },
    // kimi/
    { id: "kimi/kimi-k3", name: "Kimi K3" },
    { id: "kimi/kimi-k2.7-code", name: "Kimi K2.7 Code" },
    // z-ai/
    { id: "z-ai/glm-5.3", name: "GLM 5.3" },
    // minimax/
    { id: "minimax/minimax-m3", name: "MiniMax M3" },
    // grok/
    { id: "grok/grok-4.6", name: "Grok 4.6" },
    { id: "grok/grok-imagine-image", name: "Grok Imagine Image", kind: "image", params: ["n", "response_format"] },
  ],
  serviceKinds: ["llm", "embedding", "tts", "image"],
  ttsConfig: {
    baseUrl: "https://api.orcarouter.ai/v1/audio/speech",
    defaultModel: "openai/gpt-4o-mini-tts",
    format: "openai",
  },
  embeddingConfig: {
    baseUrl: "https://api.orcarouter.ai/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
  },
  imageConfig: {
    baseUrl: "https://api.orcarouter.ai/v1/images/generations",
  },
  modelsFetcher: { url: "https://api.orcarouter.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
