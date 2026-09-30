export default {
  id: "searchapi",
  alias: "searchapi",
  display: {
    name: "SearchAPI",
    icon: "search",
    color: "#0EA5A4",
    textIcon: "SA",
    website: "https://www.searchapi.io",
    notice: {
      apiKeyUrl: "https://www.searchapi.io/dashboard"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "webSearch"
  ],
  searchConfig: {
    baseUrl: "https://www.searchapi.io/api/v1/search",
    method: "GET",
    authType: "apikey",
    authHeader: "api_key",
    costPerQuery: 0.004,
    freeMonthlyQuota: 100,
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
