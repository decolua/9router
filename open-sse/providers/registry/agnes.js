export default {
  id: "agnes",
  priority: 120,
  alias: "agnes",
  aliases: [
    "agnes-ai",
  ],
  uiAlias: "agnes",
  display: {
    name: "Agnes AI",
    icon: "auto_awesome",
    color: "#7C3AED",
    textIcon: "AG",
    website: "https://agnes-ai.com",
    notice: {
      text: "OpenAI-compatible gateway from Agnes AI, offering free API credits on sign-up. Accepts a bearer token or an x-api-key header.",
      apiKeyUrl: "https://platform.agnes-ai.com",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://apihub.agnes-ai.com/v1/chat/completions",
    validateUrl: "https://apihub.agnes-ai.com/v1/models",
  },
  // No model ids could be verified without a key, so discovery is left to the
  // live endpoint and any id is accepted through passthroughModels.
  passthroughModels: true,
};
