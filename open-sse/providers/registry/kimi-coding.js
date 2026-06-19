import { CLAUDE_API_HEADERS, KIMI_CODING_BASE_URL } from "../shared.js";

export default {
  id: "kimi-coding",
  hidden: true,
  priority: 120,
  alias: "kmc",
  display: {
    name: "Kimi Coding",
    icon: "psychology",
    color: "#1E40AF",
    textIcon: "KC",
    website: "https://kimi.moonshot.cn",
    notice: {
      signupUrl: "https://kimi.moonshot.cn",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: "https://api.kimi.com/coding/v1/messages",
    format: "claude",
    urlSuffix: "?beta=true",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14",
    },
    clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    refreshUrl: "https://auth.kimi.com/api/oauth/token",
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
      hooks: [
        "kimiHeaders",
      ],
    },
  },
  models: [
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "kimi-k2.5-thinking", name: "Kimi K2.5 Thinking" },
    { id: "kimi-latest", name: "Kimi Latest" },
  ],
  oauth: {
    deviceCodeUrl: "https://auth.kimi.com/api/oauth/device_authorization",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    refreshLeadMs: 300000,
  },
  features: {
    usage: true,
  },
};
