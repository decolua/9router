import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "glm",
  priority: 140,
  alias: "glm",
  display: {
    name: "GLM Coding",
    icon: "code",
    color: "#2563EB",
    textIcon: "GL",
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
    website: "https://z.ai",
    notice: {
      text: "Z.AI international (z.ai). OAuth Coding Plan or API key via api.z.ai.",
      apiKeyUrl: "https://z.ai",
      signupUrl: "https://z.ai",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.z.ai/api/anthropic/v1/messages",
    format: "claude",
    headers: {
      ...CLAUDE_API_HEADERS,
    },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
    },
    usage: {
      url: "https://api.z.ai/api/monitor/usage/quota/limit",
    },
  },
  models: [
    { id: "glm-5.2", name: "GLM 5.2", upstreamModelId: "GLM-5.2" },
    { id: "glm-5.1", name: "GLM 5.1", upstreamModelId: "GLM-5.1" },
    { id: "glm-5-turbo", name: "GLM 5 Turbo", upstreamModelId: "GLM-5-Turbo" },
    { id: "glm-5", name: "GLM 5" },
    { id: "glm-4.7", name: "GLM 4.7", upstreamModelId: "GLM-4.7" },
    { id: "glm-4.6", name: "GLM 4.6" },
    { id: "glm-4.6v", name: "GLM 4.6V (Vision)" },
  ],
  oauth: {
    refreshLeadMs: 600000,
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};