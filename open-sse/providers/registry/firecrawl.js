export default {
  id: "firecrawl",
  alias: "firecrawl",
  display: {
    name: "Firecrawl",
    icon: "local_fire_department",
    color: "#F59E0B",
    textIcon: "FC",
    website: "https://firecrawl.dev",
    notice: {
      apiKeyUrl: "https://www.firecrawl.dev/app/api-keys"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "webSearch",
    "webFetch"
  ],
  searchConfig: {
    baseUrl: "https://api.firecrawl.dev/v2/search",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0.001,
    freeMonthlyQuota: 1000,
    searchTypes: [
      "web",
      "news"
    ],
    defaultMaxResults: 5,
    maxMaxResults: 100,
    timeoutMs: 15000,
    cacheTTLMs: 300000
  },
  fetchConfig: {
    baseUrl: "https://api.firecrawl.dev/v2/scrape",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0.001,
    freeMonthlyQuota: 1000,
    formats: [
      "markdown",
      "html",
      "rawHtml"
    ],
    maxCharacters: 200000,
    timeoutMs: 30000
  }
};
