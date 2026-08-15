export default {
  id: "ghm",
  priority: 75,
  alias: "ghm",
  uiAlias: "ghm",
  display: {
    name: "GitHub Models",
    icon: "code",
    color: "#0366D6",
    textIcon: "GH",
    website: "https://github.com/marketplace/models",
    notice: {
      apiKeyUrl: "https://github.com/settings/tokens",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://models.github.ai/inference/chat/completions",
    validateUrl: "https://models.github.ai/inference/models",
  },
  // Model list needs to be populated with verified GitHub Models IDs from:
  // https://github.com/marketplace/models
  models: [],
};
