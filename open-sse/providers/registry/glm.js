import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "glm",
  priority: 140,
  hasFree: true,
  alias: "glm",
  display: {
    name: "GLM Coding",
    icon: "code",
    color: "#2563EB",
    textIcon: "GL",
    website: "https://open.bigmodel.cn",
    notice: {
      text: "GLM-4.7-Flash permanent free (unlimited, ~1 req/s) + GLM-5.3-Flash promo free 200 req/day. Auto-discovered via modelsFetcher.",
      apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    },
  },
  category: "freeTier",
  hasFree: true,
  transport: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    validateUrl: "https://open.bigmodel.cn/api/paas/v4/models",
    headers: {},
    usage: {
      url: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
    },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "openai",
      baseUrl: "https://api.z.ai/api/coding/paas/v4/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
      urlSuffix: "?beta=true",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  models: [
    { id: "glm-4.7-flash", name: "GLM 4.7 Flash (Permanent Free)", free: true },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash (Promo Free 200/day)", free: true },
    { id: "glm-4.5-flash", name: "GLM 4.5 Flash (Free)", free: true },
    { id: "glm-4.6v-flash", name: "GLM 4.6V Flash (Free)", free: true },
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "glm-5", name: "GLM 5" },
    { id: "glm-4.7", name: "GLM 4.7" },
    { id: "glm-4.6v", name: "GLM 4.6V (Vision)" },
  ],
  modelsFetcher: { url: "https://open.bigmodel.cn/api/paas/v4/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm", "webSearch"],
  searchConfig: {
    baseUrl: "https://api.z.ai/api/mcp/web_search_prime/mcp",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    costPerQuery: 0,
    searchTypes: ["web"],
    defaultMaxResults: 5,
    maxMaxResults: 50,
    timeoutMs: 10000,
    cacheTTLMs: 300000,
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
