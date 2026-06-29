export default {
  id: "kimchi",
  priority: 95,
  alias: "kimchi",
  uiAlias: "kimchi",
  display: {
    name: "Kimchi",
    icon: "restaurant",
    color: "#FF521D",
    textIcon: "KC",
    website: "https://kimchi.dev",
    notice: {
      signupUrl: "https://app.kimchi.dev",
    },
  },
  category: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://llm.kimchi.dev/openai/v1/chat/completions",
    format: "openai",
    headers: {
      "User-Agent": "kimchi/0.0.0",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  models: [
    { id: "minimax-m3", name: "MiniMax-M3" },
    { id: "kimi-k2.7", name: "Kimi-K2.7" },
    { id: "kimi-k2.6", name: "Kimi-K2.6" },
    { id: "kimi-k2.5", name: "Kimi-K2.5" },
    { id: "nemotron-3-ultra-fp4", name: "Nemotron 3 Ultra FP4" },
    { id: "minimax-m2.7", name: "MiniMax-M2.7" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  ],
  serviceKinds: ["llm", "imageToText"],
  oauth: {
    webAppUrl: "https://app.kimchi.dev",
    validationUrl: "https://api.cast.ai/v1/llm/openai/supported-providers",
    userInfoUrl: "https://app.kimchi.dev/api/v1/me",
    modelsUrl: "https://llm.kimchi.dev/v1/models/metadata?include_in_cli=true",
  },
  passthroughModels: true,
};
