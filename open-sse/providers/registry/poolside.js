export default {
  id: "poolside",
  priority: 60,
  alias: "poolside",
  aliases: [
    "ps",
  ],
  uiAlias: "ps",
  display: {
    name: "Poolside",
    icon: "water_drop",
    color: "#0EA5E9",
    textIcon: "PS",
    website: "https://poolside.ai",
    notice: {
      apiKeyUrl: "https://platform.poolside.ai/api-keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://inference.poolside.ai/v1/chat/completions",
    validateUrl: "https://inference.poolside.ai/v1/models",
  },
  models: [
    { id: "poolside/laguna-s-2.1", name: "Laguna S 2.1" },
    { id: "poolside/laguna-xs-2.1", name: "Laguna XS 2.1" },
    { id: "poolside/laguna-m.1", name: "Laguna M.1" },
  ],
};
