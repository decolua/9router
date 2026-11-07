export default {
  id: "jembatanai",
  priority: 120,
  alias: "jembatanai",
  aliases: [
    "jai",
  ],
  uiAlias: "jai",
  display: {
    name: "JembatanAI",
    icon: "hub",
    color: "#047857",
    textIcon: "JA",
    website: "https://jembatanai.com/?utm_campaign=9router",
    notice: {
      text: "OpenAI-compatible gateway. Model ids carry the vendor (e.g. anthropic/claude-sonnet-5) and are fetched live per key. Subscription keys: unlimited tokens under a fair-use policy, paced at 30 requests per minute per key (25 on daily plans); a 2M-token trial key is available.",
      apiKeyUrl: "https://t.me/jembatanai_bot?start=9router",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    // OpenAI-compatible. `format` is left at the shared "openai" default and
    // `thinkingFormat` is deliberately NOT declared: the catalogue spans several
    // vendors, so each model must resolve its own thinking wire format through
    // providers/capabilities.js. Setting a provider-wide value would force one
    // format (e.g. claude-adaptive) onto every model.
    baseUrl: "https://freeai.jembatanai.com/v1/chat/completions",
    // GET /v1/models is key-gated: it lists only the ids the key may call and
    // rejects a bad key, so it doubles as the key check.
    validateUrl: "https://freeai.jembatanai.com/v1/models",
  },
  // Offline fallback only; the live per-key catalogue is fetched via
  // modelsFetcher and any other id is accepted via passthroughModels. Ids carry
  // the upstream vendor (vendor/model), so they contain a slash.
  models: [
    { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5" },
    { id: "openai/gpt-6-luna", name: "GPT-6 Luna" },
    { id: "z-ai/glm-5.2", name: "GLM-5.2" },
    { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
  ],
  modelsFetcher: { url: "https://freeai.jembatanai.com/v1/models", type: "openai" },
  passthroughModels: true,
};
