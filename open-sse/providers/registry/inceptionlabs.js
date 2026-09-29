export default {
  id: "inceptionlabs",
  priority: 120,
  alias: "inceptionlabs",
  aliases: [
    "inception",
  ],
  uiAlias: "inceptionlabs",
  display: {
    name: "Inception Labs",
    icon: "blur_on",
    color: "#0B1A1A",
    textIcon: "IL",
    website: "https://www.inceptionlabs.ai",
    notice: {
      text: "Mercury diffusion LLMs (dLLM) served over an OpenAI-compatible Chat Completions API.",
      apiKeyUrl: "https://platform.inceptionlabs.ai/dashboard/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.inceptionlabs.ai/v1/chat/completions",
  },
  // Chat models only. mercury-edit-2 lives on /v1/fim and /v1/edit, which are
  // not Chat Completions, so it is intentionally not listed here.
  models: [
    { id: "mercury-2.5", name: "Mercury 2.5" },
    { id: "mercury-2", name: "Mercury 2" },
  ],
  modelsFetcher: { url: "https://api.inceptionlabs.ai/v1/models", type: "openai" },
};
