export default {
  id: "openai",
  priority: 30,
  alias: "openai",
  display: {
    name: "OpenAI",
    icon: "auto_awesome",
    color: "#10A37F",
    textIcon: "OA",
    website: "https://platform.openai.com",
    notice: {
      apiKeyUrl: "https://platform.openai.com/api-keys",
    },
  },
  category: "apikey",
  thinkingConfig: {
    options: [
      "auto",
      "none",
      "low",
      "medium",
      "high",
    ],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://api.openai.com/v1/chat/completions",
    forceStream: true,
  },
  // Multi-endpoint: the same API key serves Chat Completions and Responses.
  // Responses clients (Codex, OpenAI SDK) stay native on /v1/responses instead of
  // the lossy Responses→Chat hop; Chat clients keep /v1/chat/completions.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.openai.com/v1/chat/completions",
    },
    {
      format: "openai-responses",
      baseUrl: "https://api.openai.com/v1/responses",
      // Strict Responses API: needs reasoning:{effort,summary}, not top-level reasoning_effort.
      thinkingFormat: "openai-responses",
    },
  ],
  // Per-connection endpoint selector in the dashboard (providerSpecificData.apiMode).
  apiModes: ["auto", "chat", "responses"],
  // Auto mode: model families that must use /v1/responses for every client.
  // GPT-5.6+ and GPT-6 reject function tools + reasoning_effort on
  // /v1/chat/completions ("use /v1/responses instead", decolua/9router#2540, #4031).
  // Matches gpt-5.6, gpt-5.6-sol, gpt-6-astra, gpt-6.1-terra…; not gpt-5.5, gpt-4o, gpt-image-*.
  modelFamilies: [
    {
      match: /^gpt-(?:5\.(?:[6-9]|\d{2,})|(?:[6-9]|\d{2,})(?:\.\d+)?)(?:-|$)/i,
      supportedFormats: ["openai-responses"],
      targetFormat: "openai-responses",
    },
  ],
  models: [
    { id: "gpt-6-astra", name: "GPT-6 Astra" },
    { id: "gpt-5.6", name: "GPT-5.6" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-5.4-nano", name: "GPT-5.4 Nano" },
    { id: "gpt-5.2", name: "GPT-5.2" },
    { id: "gpt-5.1", name: "GPT-5.1" },
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
    { id: "gpt-5-nano", name: "GPT-5 Nano" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
    { id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },
    { id: "o3", name: "O3" },
    { id: "o3-mini", name: "O3 Mini" },
    { id: "o3-pro", name: "O3 Pro" },
    { id: "o4-mini", name: "O4 Mini" },
    { id: "o1", name: "O1" },
    { id: "o1-mini", name: "O1 Mini" },
    { id: "text-embedding-3-large", name: "Text Embedding 3 Large", kind: "embedding" },
    { id: "text-embedding-3-small", name: "Text Embedding 3 Small", kind: "embedding" },
    { id: "text-embedding-ada-002", name: "Text Embedding Ada 002", kind: "embedding" },
    { id: "tts-1", name: "TTS-1", kind: "tts" },
    { id: "tts-1-hd", name: "TTS-1 HD", kind: "tts" },
    { id: "gpt-4o-mini-tts", name: "GPT-4o Mini TTS", kind: "tts" },
    { id: "whisper-1", name: "Whisper 1", params: ["language","response_format","temperature","prompt"], kind: "stt" },
    { id: "gpt-4o-transcribe", name: "GPT-4o Transcribe", params: ["language","response_format","temperature","prompt"], kind: "stt" },
    { id: "gpt-4o-mini-transcribe", name: "GPT-4o Mini Transcribe", params: ["language","response_format","temperature","prompt"], kind: "stt" },
    { id: "gpt-image-2.5", name: "GPT Image 2.5", params: ["n","size","quality","response_format"], kind: "image" },
    { id: "gpt-image-2.5-flare", name: "GPT Image 2.5 Flare", params: ["n","size","quality","response_format"], kind: "image" },
    { id: "gpt-image-2.5-sunburst", name: "GPT Image 2.5 Sunburst", params: ["n","size","quality","response_format"], kind: "image" },
    { id: "gpt-image-1", name: "GPT Image 1", params: ["n","size","quality","response_format"], kind: "image" },
    { id: "dall-e-3", name: "DALL-E 3", params: ["size","quality","style","response_format"], kind: "image" },
    { id: "dall-e-2", name: "DALL-E 2", params: ["n","size","response_format"], kind: "image" },
  ],
  serviceKinds: ["llm","embedding","tts","stt","image","imageToText","webSearch"],
  ttsConfig: {
    baseUrl: "https://api.openai.com/v1/audio/speech",
    authType: "apikey",
    authHeader: "bearer",
    format: "openai",
    defaultModel: "gpt-4o-mini-tts",
  },
  sttConfig: {
    baseUrl: "https://api.openai.com/v1/audio/transcriptions",
    authType: "apikey",
    authHeader: "bearer",
    format: "openai",
  },
  embeddingConfig: { baseUrl: "https://api.openai.com/v1/embeddings", authType: "apikey", authHeader: "bearer" },
  imageConfig: { baseUrl: "https://api.openai.com/v1/images/generations" },
  searchViaChat: { defaultModel: "gpt-4o-mini", pricingUrl: "https://openai.com/api/pricing" },
};
