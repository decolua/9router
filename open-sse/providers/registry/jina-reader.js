export default {
  id: "jina-reader",
  alias: "jina-reader",
  display: {
    name: "Jina Reader",
    icon: "menu_book",
    color: "#000000",
    textIcon: "JR",
    website: "https://jina.ai/reader",
    notice: {
      apiKeyUrl: "https://jina.ai/?sui=apikey"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "webFetch"
  ],
  fetchConfig: {
    baseUrl: "https://r.jina.ai",
    method: "GET",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0,
    freeMonthlyQuota: 1000000,
    formats: [
      "markdown",
      "text",
      "html"
    ],
    maxCharacters: 200000,
    timeoutMs: 30000
  }
};
