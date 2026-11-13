export default {
  id: "parallel",
  alias: "parallel",
  display: {
    name: "Parallel",
    icon: "hub",
    color: "#0F172A",
    textIcon: "PA",
    website: "https://parallel.ai",
    notice: {
      apiKeyUrl: "https://platform.parallel.ai"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "webSearch",
    "webFetch"
  ],
  searchConfig: {
    baseUrl: "https://api.parallel.ai/v1/search",
    method: "POST",
    authType: "apikey",
    authHeader: "x-api-key",
    preventRedirects: true,
    costPerQuery: 0.001,
    costByMode: { turbo: 0.001, fast: 0.001, basic: 0.005, advanced: 0.005 },
    extraResultCost: 0.001,
    includedResults: 10,
    searchTypes: ["web"],
    defaultMaxResults: 5,
    maxMaxResults: 20,
    timeoutMs: 10000,
    cacheTTLMs: 300000
  },
  fetchConfig: {
    baseUrl: "https://api.parallel.ai/v1/extract",
    method: "POST",
    authType: "apikey",
    authHeader: "x-api-key",
    costPerQuery: 0.001,
    formats: [
      "markdown"
    ],
    maxCharacters: 100000,
    timeoutMs: 60000
  }
};
