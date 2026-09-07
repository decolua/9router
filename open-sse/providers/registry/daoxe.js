export default {
  id: "daoxe",
  alias: "daoxe",
  aliases: [
    "dao-xe",
  ],
  uiAlias: "daoxe",
  display: {
    name: "DaoXE",
    icon: "dao",
    color: "#0F766E",
    textIcon: "DX",
    website: "https://daoxe.com",
    notice: {
      text: "OpenAI-compatible gateway. Hundreds of models (Claude, GPT, Gemini, Grok, DeepSeek, Kimi, Qwen, GLM) via one key; native Anthropic Messages support.",
      apiKeyUrl: "https://daoxe.com/token",  // NewAPI token page
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.daoxe.com/v1/chat/completions",
    validateUrl: "https://api.daoxe.com/v1/models",
  },
  // Seed snapshot of the default-group catalog. Model availability is
  // account-scoped; live list is fetched via modelsFetcher and other ids are
  // still accepted via passthroughModels.
  models: [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "grok-4.5", name: "Grok 4.5" },
    { id: "grok-4.3", name: "Grok 4.3" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
  ],
  serviceKinds: ["llm", "embedding"],
  embeddingConfig: {
    baseUrl: "https://api.daoxe.com/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
  },
  modelsFetcher: { url: "https://api.daoxe.com/v1/models", type: "openai" },
  passthroughModels: true,
};
