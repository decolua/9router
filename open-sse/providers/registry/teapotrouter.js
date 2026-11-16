export default {
  id: "teapotrouter",
  alias: "teapotrouter",
  aliases: ["tpr"],
  uiAlias: "tpr",
  display: {
    name: "TeaPotRouter",
    icon: "emoji_food_beverage",
    color: "#0F766E",
    textIcon: "TP",
    website: "https://teapotrouter.com",
    notice: {
      text: "Pay-as-you-go API relay for the Claude and GPT model families. One key works across OpenAI-compatible and Anthropic-compatible endpoints.",
      apiKeyUrl: "https://teapotrouter.com/dashboard",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.teapotrouter.com/v1/chat/completions",
    validateUrl: "https://api.teapotrouter.com/v1/models",
  },
  // Seed snapshot from live /v1/models (2026-11-18). The catalogue keeps
  // growing — latest ids are fetched via modelsFetcher; unknown ids still
  // accepted through passthroughModels.
  models: [
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
    { id: "claude-fable-5", name: "Claude Fable 5" },
    { id: "claude-fable-5-2", name: "Claude Fable 5.2" },
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
    { id: "gpt-6-astra", name: "GPT-6 Astra" },
    { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
    { id: "gpt-6.1-terra", name: "GPT-6.1 Terra" },
  ],
  serviceKinds: ["llm"],
  modelsFetcher: { url: "https://api.teapotrouter.com/v1/models", type: "openai" },
  passthroughModels: true,
};
