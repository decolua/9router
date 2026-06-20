export default {
  id: "routerai",
  priority: 30,
  hasFree: true,
  alias: "routerai",
  aliases: ["ra"],
  uiAlias: "routerai",
  display: {
    name: "RouterAI",
    icon: "cpu",
    color: "#6366F1",
    textIcon: "RA",
    website: "https://routerai.ru",
    notice: {
      text: "RouterAI — российский маршрутизатор LLM. Требуется API ключ.",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://routerai.ru/api/v1/chat/completions",
    thinkingFormat: "openai",
  },
  models: [],
  passthroughModels: true,
};
