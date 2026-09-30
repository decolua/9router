export default {
  id: "youcom",
  alias: "youcom",
  display: {
    name: "You.com Search",
    icon: "search",
    color: "#7C3AED",
    textIcon: "YC",
    website: "https://you.com",
    notice: {
      apiKeyUrl: "https://api.you.com"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "webSearch"
  ],
  searchConfig: {
    baseUrl: "https://ydc-index.io/v1/search",
    method: "GET",
    authType: "apikey",
    authHeader: "x-api-key",
    costPerQuery: 0.005,
    freeMonthlyQuota: 0,
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
