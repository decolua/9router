import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "hcnsec",
  priority: 120,
  alias: "hcnsec",
  aliases: [
    "hc",
    "hcn",
  ],
  uiAlias: "hcnsec",
  display: {
    name: "HCNSec",
    icon: "hub",
    color: "#1E6FEB",
    textIcon: "HC",
    website: "https://api.hcnsec.cn",
    notice: {
      text: "OpenAI-compatible public-interest gateway (Xinjiang Huancheng Wang'an). GLM, DeepSeek, Qwen, Step, MiMo, MiniCPM and SenseNova models; a subset also answers on the Anthropic /v1/messages lane. Model ids are bare and fetched live from the provider.",
      apiKeyUrl: "https://api.hcnsec.cn/console/token",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.hcnsec.cn/v1/chat/completions",
    validateUrl: "https://api.hcnsec.cn/v1/models",
    // The upstream is a New API fork that relays third-party models, so every
    // model takes OpenAI-style `reasoning_effort` regardless of vendor. Without
    // a provider-wide value each model would resolve its own wire format from
    // providers/capabilities.js (zai / qwen / deepseek / minimax / step) and the
    // relay would reject the vendor-native thinking shapes.
    thinkingFormat: "openai",
    retry: {
      429: 2,
    },
    // The gateway is time-varying: the same model can answer in 2s and then hang
    // past 300s minutes later, and it emits transient 404/500 bodies that look
    // exactly like a genuine "model not found" (e.g. a clean 6/6 chat run followed
    // by 5/6 on /v1/responses). DEFAULT_RETRY_CONFIG only retries 429/502/503/504,
    // so these surface to the caller. Deliberately NOT retried on 404: that would
    // mask a real bad model id, which is the more common and more dangerous case.
  },
  // Multi-endpoint: pick the transport matching the client's sourceFormat to
  // skip translation. Guarded per-model by `supportedFormats` (see chatCore)
  // because only a subset of the catalogue answers on /v1/messages.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.hcnsec.cn/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.hcnsec.cn/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      // Transport-level thinkingFormat wins over the provider-level "openai"
      // (resolveFormat in translator/concerns/thinkingUnified.js), so the
      // Anthropic lane keeps sending thinking:{type,budget_tokens} instead of a
      // Chat-shaped reasoning_effort the Messages API does not accept.
      thinkingFormat: "claude-budget",
      // Bearer, not x-api-key: probing /v1/messages with a bad key returns the
      // same 401 for every header variant, and bearer is the shape the New API
      // token middleware actually resolves.
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  // Live catalogue (19 ids, read from the site's pricing table and confirmed
  // against /v1/models). Ids are bare — the gateway does not namespace them by
  // upstream vendor. `supportedFormats` is declared on every chat model:
  // chatCore only honours the source-format-matched transport when the model
  // declares that format, and an UNDECLARED id keeps the matched transport — so
  // leaving a chat-only model undeclared would send a Claude client to
  // /v1/messages, where the gateway has no route for it. Media-only ids carry no
  // supportedFormats because they never travel the chat lane.
  models: [
    { id: "auto", name: "Auto (Router)", supportedFormats: ["openai", "claude"] },
    { id: "DeepSeek-V4-Flash", name: "DeepSeek V4 Flash", supportedFormats: ["openai", "claude"] },
    { id: "DeepSeek-V4-Pro", name: "DeepSeek V4 Pro", supportedFormats: ["openai", "claude"] },
    { id: "DeepSeek-V4.1-Flash", name: "DeepSeek V4.1 Flash", supportedFormats: ["openai", "claude"] },
    { id: "glm-5.3", name: "GLM-5.3", supportedFormats: ["openai", "claude"] },
    { id: "glm-5.3-flash", name: "GLM-5.3 Flash", supportedFormats: ["openai", "claude"] },
    { id: "MiMo-V2.6-Flash", name: "MiMo V2.6 Flash", supportedFormats: ["openai"] },
    { id: "MiniCPM-V-4.7-35B-A3B", name: "MiniCPM-V 4.7 35B A3B", supportedFormats: ["openai"] },
    { id: "MiniMax-M3.1-Flash", name: "MiniMax M3.1 Flash", supportedFormats: ["openai", "claude"] },
    { id: "Qwen3-Embedding-8B", name: "Qwen3 Embedding 8B", kind: "embedding" },
    { id: "Qwen3.8-27B", name: "Qwen3.8 27B", supportedFormats: ["openai"] },
    { id: "Qwen3.8-Flash-Next", name: "Qwen3.8 Flash Next", supportedFormats: ["openai"] },
    { id: "sensenova-6.8-flash-lite", name: "SenseNova 6.8 Flash Lite", supportedFormats: ["openai"] },
    { id: "sensenova-u1.5-lite", name: "SenseNova U1.5 Lite", supportedFormats: ["openai"] },
    { id: "step-5-preview", name: "Step 5 Preview", supportedFormats: ["openai"] },
    { id: "stepaudio-2.5-asr", name: "StepAudio 2.5 ASR", kind: "stt" },
    { id: "stepaudio-2.5-chat", name: "StepAudio 2.5 Chat", supportedFormats: ["openai"] },
    { id: "stepaudio-2.5-realtime", name: "StepAudio 2.5 Realtime", supportedFormats: ["openai"] },
    { id: "stepaudio-2.5-tts", name: "StepAudio 2.5 TTS", kind: "tts" },
  ],
  serviceKinds: ["llm", "embedding", "tts"],
  embeddingConfig: {
    baseUrl: "https://api.hcnsec.cn/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
  },
  // No sttConfig: /v1/audio/transcriptions is broken upstream. Every multipart shape
  // returns 404 bad_response_status_code for stepaudio-2.5-asr — with the `file` field
  // (correct), with `audio`, and with a real speech MP3 produced by this gateway's own
  // TTS lane (5/5 attempts). A non-WAV mime gets past the endpoint and then fails at
  // "error getting audio duration", so the relay's ASR converter is at fault, not the
  // request. Declaring a lane here would render an STT card that can never succeed.
  ttsConfig: {
    baseUrl: "https://api.hcnsec.cn/v1/audio/speech",
    authType: "apikey",
    authHeader: "bearer",
    format: "openai",
    models: [
      { id: "stepaudio-2.5-tts", name: "StepAudio 2.5 TTS" },
    ],
    // "alloy" is an OpenAI-only voice id and this relay rejects it with
    // voice_id_invalid. defaultVoice is the fallback the shared openai-compat handler
    // uses when the request carries no voice, so `hcnsec/stepaudio-2.5-tts` works bare.
    // The gateway publishes no voice endpoint (/v1/audio/voices → 404), so the seven
    // ids it does serve were found by probing — all verified to return audio/mpeg:
    //   cixingnansheng, zhengpaiqingnian, wenrounvsheng, jilingshaonv,
    //   ruanmengnvsheng, qingniandaxuesheng, shenchennanyin
    // Rejected: alloy, shimmer, nova, step-1, male, female, default, zh-CN-female-1,
    // Cherry, yuanqinvsheng, dashunansheng.
    defaultVoice: "cixingnansheng",
  },
  // /v1/models is auth-gated (401 without a key), so the app-side
  // PROVIDER_MODELS_CONFIG entry in the [id]/models route is the primary
  // discovery path; this fetcher is kept for parity with the other aggregators.
  modelsFetcher: { url: "https://api.hcnsec.cn/v1/models", type: "openai" },
  passthroughModels: true,
};
