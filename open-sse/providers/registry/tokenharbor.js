export default {
  id: "tokenharbor",
  priority: 120,
  alias: "tokenharbor",
  aliases: [
    "th",
    "thh",
  ],
  uiAlias: "tokenharbor",
  display: {
    name: "Token Harbor",
    icon: "anchor",
    color: "#0F766E",
    textIcon: "TH",
    website: "https://tokenharbor.ai",
    notice: {
      text: "OpenAI-compatible aggregator. One API key reaches every model, billed per-token from a prepaid wallet. Model ids are bare (e.g. claude-opus-5.5, gpt-6-astra, deepseek-v4.1-flash:free) and are fetched live from the provider.",
      apiKeyUrl: "https://tokenharbor.ai/dashboard",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    // OpenAI-compatible. `format` is left at the shared "openai" default and
    // `thinkingFormat` is deliberately NOT declared: Token Harbor forwards
    // requests verbatim, so each model must resolve its own thinking wire
    // format through providers/capabilities.js. Setting a provider-wide value
    // would force one format (e.g. claude-adaptive) onto every model.
    baseUrl: "https://tokenharbor.ai/v1/chat/completions",
    validateUrl: "https://tokenharbor.ai/v1/models",
    retry: {
      429: 2,
    },
  },
  // Curated seed; the live catalogue is fetched via modelsFetcher and any other
  // id is accepted via passthroughModels. Their catalogue rotates (the :free set
  // in particular), so this stays deliberately small and is only the offline
  // fallback. Ids are bare — Token Harbor does not prefix them by upstream vendor.
  models: [
    { id: "claude-opus-5.5", name: "Claude Opus 5.5" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "gpt-6-astra", name: "GPT-6 Astra" },
    { id: "gpt-6-sol", name: "GPT-6 Sol" },
    { id: "deepseek-v4.1-flash:free", name: "DeepSeek V4.1 Flash (Free)" },
    { id: "grok-4.7", name: "Grok 4.7" },
  ],
  modelsFetcher: { url: "https://tokenharbor.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
