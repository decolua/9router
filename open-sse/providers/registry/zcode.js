export default {
  id: "zcode",
  alias: "zc",
  uiAlias: "zc",
  display: {
    name: "ZCode (Z.ai)",
    icon: "terminal",
    color: "#0F8BFF",
    textIcon: "ZC",
    website: "https://zcode.z.ai",
    notice: {
      signupUrl: "https://zcode.z.ai",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,
  authModes: ["oauth"],
  features: {
    usage: true,
  },
  transport: {
    baseUrl: "https://api.z.ai/api/anthropic",
    format: "claude",
    // Plan traffic defaults to SSE upstream; non-stream clients are converted
    // back to JSON by the forced-SSE handler.
    forceStream: true,
    headers: {
      "anthropic-version": "2023-06-01",
      "User-Agent": "ZCode/3.17.1",
    },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
    },
    quirks: {
      preserveCacheControl: true,
    },
  },
  models: [
    { id: "GLM-5.3-Flash", name: "GLM-5.3 Flash" },
    { id: "GLM-5.3", name: "GLM-5.3" },
    { id: "GLM-5.2", name: "GLM-5.2" },
    { id: "GLM-5-Turbo", name: "GLM-5 Turbo" },
  ],
  oauth: {
    clientId: "client_P8X5CMWmlaRO9gyO-KSqtg",
    authorizeUrl: "https://chat.z.ai/api/oauth/authorize",
    tokenUrl: "https://zcode.z.ai/api/v1/oauth/token",
    // Device login uses the official ZCode CLI polling flow.
    providerId: "zai",
    cliInitUrl: "https://zcode.z.ai/api/v1/oauth/cli/init",
    cliPollUrl: "https://zcode.z.ai/api/v1/oauth/cli/poll",
    businessLoginUrl: "https://api.z.ai/api/auth/z/login",
    apiBaseUrl: "https://api.z.ai",
    scopes: [],
    refreshLeadMs: 3600000,
  },
};
