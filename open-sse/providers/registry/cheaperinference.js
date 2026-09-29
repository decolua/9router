export default {
  id: "cheaperinference",
  priority: 120,
  alias: "cheaperinference",
  aliases: [
    "cheaper-inference",
  ],
  uiAlias: "cheaperinference",
  display: {
    name: "Cheaper Inference",
    icon: "savings",
    color: "#15803D",
    textIcon: "CI",
    website: "https://cheaperinference.com",
    notice: {
      text: "OpenAI-compatible LLM gateway. One API key reaches models from many labs. Each model costs 15–60% less than the list price of its lab. Model ids are bare (e.g. gpt-5.4-mini, claude-sonnet-5) and are fetched live from the provider.",
      apiKeyUrl: "https://cheaperinference.com/signup",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    // OpenAI-compatible. `format` stays at the shared "openai" default and
    // `thinkingFormat` is not declared, so each model resolves its own
    // thinking wire format through providers/capabilities.js.
    baseUrl: "https://api.cheaperinference.com/v1/chat/completions",
    validateUrl: "https://api.cheaperinference.com/v1/models",
  },
  // Small seed for offline use. The live catalogue is fetched via modelsFetcher
  // (needs the API key) and any other id is accepted via passthroughModels.
  models: [
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
  ],
  modelsFetcher: { url: "https://api.cheaperinference.com/v1/models", type: "openai" },
  passthroughModels: true,
};
