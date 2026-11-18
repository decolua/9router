import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "glm",
  priority: 140,
  alias: "glm",
  display: {
    name: "Zai GLM Coding",
    icon: "code",
    color: "#2563EB",
    textIcon: "GL",
    website: "https://open.bigmodel.cn",
    notice: {
      apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
      signupUrl: "https://chat.z.ai",
    },
  },
  category: "oauth",
  // Dual-auth like kimi: paste an API key, or OAuth-login with the Z.ai
  // account to auto-mint a coding-plan key.
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  hasProviderSpecificData: true,
  plans: [
    { id: "individual-coding-plan", label: "Individual Coding Plan", authModes: ["oauth", "apikey"] },
    { id: "team-coding-plan", label: "Team Coding Plan", authModes: ["oauth", "apikey"] },
    { id: "start-plan", label: "Start Plan", authModes: ["oauth"] },
  ],
  defaultPlan: "individual-coding-plan",
  // ponytail: off-peak/highspeed stay hidden because ZCode marks these card
  // modes hidden; expose them if ZCode promotes them to public plan choices.
  // OAuth = ZCode CLI polling flow (apps/zcode-cli cli-oauth.ts) — no PKCE, no
  // local callback: init mints a one-off poll token, the browser authorize_url
  // is server-generated, and poll/ready carries the tokens. The Z.AI OAuth
  // token is exchanged for a business JWT, then a long-lived coding-plan API
  // key (no refresh grant — re-login on expiry, same as the official CLI).
  oauth: {
    providerId: "zai",
    cliInitUrl: "https://zcode.z.ai/api/v1/oauth/cli/init",
    cliPollUrl: "https://zcode.z.ai/api/v1/oauth/cli/poll",
    businessLoginUrl: "https://api.z.ai/api/auth/z/login",
    apiBaseUrl: "https://api.z.ai",
    planApiKeyName: "zcode-api-key",
  },
  transport: {
    baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
    format: "claude",
    urlSuffix: "?beta=true",
    headers: { ...CLAUDE_API_HEADERS },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
    },
    usage: {
      url: "https://api.z.ai/api/monitor/usage/quota/limit",
    },
    plans: {
      "individual-coding-plan": {
        tokenField: "individualCodingPlanApiKey",
      },
      "team-coding-plan": {
        tokenField: "teamCodingPlanApiKey",
      },
      "start-plan": {
        baseUrl: "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages",
        format: "claude",
        headers: {},
        auth: { combined: true, header: "Authorization", scheme: "bearer", tokenField: "zcodeJwtToken" },
        supportedModels: ["glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-5-turbo"],
      },
      "off-peak": {
        baseUrl: "https://zcode.z.ai/api/v1/off-peak/anthropic/v1/messages",
        format: "claude",
        headers: {},
        auth: { combined: true, header: "Authorization", scheme: "bearer", tokenField: "zcodeJwtToken" },
        supportedModels: ["glm-5.3", "glm-5.3-flash"],
        hidden: true,
      },
      highspeed: {
        baseUrl: "https://zcode.z.ai/api/v1/highspeed/anthropic/v1/messages",
        format: "claude",
        headers: {},
        auth: { combined: true, header: "Authorization", scheme: "bearer", tokenField: "zcodeJwtToken" },
        supportedModels: ["glm-5.3", "glm-5.3-flash"],
        hidden: true,
      },
    },
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
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
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash (Vision)" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "glm-5-turbo", name: "GLM 5 Turbo" },
    { id: "glm-5", name: "GLM 5" },
    { id: "glm-4.7", name: "GLM 4.7" },
    { id: "glm-4.6v", name: "GLM 4.6V (Vision)" },
  ],
  serviceKinds: ["llm", "webSearch"],
  // Coding plan bundles web search on the same API key as chat.
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
