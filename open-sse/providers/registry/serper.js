export default {
  id: "serper",
  alias: "serper",
  display: {
    name: "Serper",
    icon: "search",
    color: "#4F46E5",
    textIcon: "SP",
    website: "https://serper.dev",
    notice: {
      apiKeyUrl: "https://serper.dev/api-key"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "webSearch"
  ],
  searchConfig: {
    baseUrl: "https://google.serper.dev",
    method: "POST",
    authType: "apikey",
    authHeader: "x-api-key",
    costPerQuery: 0.001,
    freeMonthlyQuota: 2500,
    searchTypes: [
      "web",
      "news"
    ],
    defaultMaxResults: 5,
    maxMaxResults: 100,
    timeoutMs: 10000,
    cacheTTLMs: 300000
  }
};
