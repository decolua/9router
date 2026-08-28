export default {
  id: "zai-search",
  alias: "zai-search",
  display: {
    name: "GLM Coding Search",
    icon: "travel_explore",
    color: "#2563EB",
    textIcon: "GS",
    website: "https://z.ai",
    notice: {
      text: "Web search via the Z.AI Coding plan MCP endpoint. Reuses the API key from the GLM Coding provider.",
      apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  serviceKinds: ["webSearch"],
  // Credential fallback: reuses the GLM Coding plan API key — one key, chat + search.
  credentialFallback: "glm",
  searchConfig: {
    baseUrl: "https://api.z.ai/api/mcp/web_search_prime/mcp",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0,
    freeMonthlyQuota: 0,
    searchTypes: ["web"],
    defaultMaxResults: 5,
    maxMaxResults: 50,
    timeoutMs: 10000,
    cacheTTLMs: 300000,
  },
};
