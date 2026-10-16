// MiniMax Code (mcode), international site — same wire protocol as the China
// entry (minimax-code.js), different hosts. Sign-ins are per-site: an account
// on agent.minimax.cn says nothing about agent.minimax.io. See
// docs/minimax-code-proxy-plan.md for the shared protocol notes.

export default {
  id: "minimax-code-global",
  priority: 80,
  alias: "mmg",
  display: {
    name: "MiniMax Code (Global)",
    icon: "smart_toy",
    color: "#FF4D4F",
    textIcon: "MM",
    website: "https://agent.minimax.io",
  },
  category: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  features: { usage: true },
  modelsFetcher: { url: "https://agent.minimax.io/mavis/api/v1/models?region=en&buildEnv=prod", type: "minimax-code" },
  transport: {
    baseUrl: "https://agent.minimax.io/mavis/api/v1/llm/v1/messages",
    format: "claude",
    thinkingFormat: "claude-adaptive",
    headers: {
      "User-Agent": "MiniMaxAgent",
      "X-Mavis-Agent-Id": "main",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      anthropicVersion: true,
      hooks: ["minimaxHeaders"],
    },
  },
  oauth: {
    clientId: "mcode-public",
    deviceUrl: "https://account.minimax.io/oauth2/device/code",
    tokenUrl: "https://account.minimax.io/oauth2/token",
    scope: "agent.default",
    audience: "agent-backend",
    // mcode access tokens live ~1h; renew early (feeds REFRESH_LEAD_MS)
    refreshLeadMs: 10 * 60 * 1000,
  },
  models: [
    { id: "MiniMax-M3.1-Flash-Preview", name: "MiniMax M3.1 Flash Preview" },
    { id: "MiniMax-M3", name: "MiniMax M3" },
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMax-M2.7-highspeed", name: "MiniMax M2.7 Highspeed" },
  ],
};
