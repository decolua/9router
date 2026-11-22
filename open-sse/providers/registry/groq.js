export default {
  id: "groq",
  priority: 60,
  hasFree: true,
  alias: "groq",
  display: {
    name: "Groq",
    icon: "speed",
    color: "#F55036",
    textIcon: "GQ",
    website: "https://groq.com",
    notice: {
      apiKeyUrl: "https://console.groq.com/keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    validateUrl: "https://api.groq.com/openai/v1/models",
    // No dedicated quota endpoint; rate-limit info rides on x-ratelimit-*
    // response headers, always included. Reuse the models list (already
    // used as validateUrl) so reading usage never costs tokens.
    usage: {
      url: "https://api.groq.com/openai/v1/models",
    },
  },
  models: [
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
    { id: "whisper-large-v3", name: "Whisper Large v3", params: ["language","response_format","temperature","prompt"], kind: "stt" },
    { id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo", params: ["language","response_format","temperature","prompt"], kind: "stt" },
    { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B" },
  ],
  serviceKinds: ["llm","imageToText","stt"],
  sttConfig: {
    baseUrl: "https://api.groq.com/openai/v1/audio/transcriptions",
    authType: "apikey",
    authHeader: "bearer",
    format: "openai",
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
