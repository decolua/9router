export default {
  id: "kenari",
  priority: 60,
  alias: "kenari",
  display: {
    name: "Kenari",
    icon: "cloud",
    color: "#B5362A",
    textIcon: "KN",
    website: "https://kenari.id",
    notice: {
      text: "Indonesian OpenAI-compatible AI gateway billed in Rupiah (IDR). One kn- API key covers the whole catalog (Claude, GPT, DeepSeek, GLM, Kimi and more). Docs: kenari.id/docs.",
      apiKeyUrl: "https://kenari.id/login?next=/keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://kenari.id/v1/chat/completions",
    validateUrl: "https://kenari.id/v1/models",
  },
  modelsFetcher: { url: "https://kenari.id/v1/models", type: "openai" },
  passthroughModels: true,
  models: [],
};
