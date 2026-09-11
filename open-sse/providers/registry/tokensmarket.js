export default {
  id: "tokensmarket",
  alias: "tokensmarket",
  aliases: ["tm"],
  uiAlias: "tokensmarket",
  display: {
    name: "Token Market",
    icon: "hub",
    color: "#2563EB",
    textIcon: "TM",
    website: "https://www.tokensmarket.ai",
    notice: {
      text: "OpenAI-compatible gateway with smart routing across leading AI models.",
      apiKeyUrl: "https://www.tokensmarket.ai/console",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  thinkingConfig: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
  },
  transport: {
    baseUrl: "https://api.tokensmarket.ai/v1/chat/completions",
    validateUrl: "https://api.tokensmarket.ai/v1/models",
    thinkingFormat: "tokensmarket",
  },
  serviceKinds: ["llm"],
  // Small seed catalog for first-run discovery. The authenticated /v1/models
  // endpoint remains authoritative, and passthrough keeps new ids usable.
  models: [
    { id: "claude-fable-5", name: "Claude Fable 5" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
  ],
  passthroughModels: true,
};
