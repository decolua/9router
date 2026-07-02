export default {
  id: "firecrawl_custom",
  alias: "firecrawl_custom",
  display: {
    name: "Firecrawl (Custom/Local)",
    icon: "local_fire_department",
    color: "#F59E0B",
    textIcon: "FC",
    website: "https://firecrawl.dev"
  },
  category: "apikey",
  noAuth: true,
  serviceKinds: [
    "webFetch"
  ],
  fetchConfig: {
    baseUrl: "http://127.0.0.1:3002/v2/scrape",
    method: "POST",
    formats: [
      "markdown",
      "html",
      "text"
    ],
    maxCharacters: 200000,
    timeoutMs: 30000
  }
};
