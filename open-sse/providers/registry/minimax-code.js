// MiniMax Code (mcode) — the coding-subscription credits, served as a provider.
// Upstream is MiniMax's agent gateway: Anthropic messages at
// {llm}/mavis/api/v1/llm/v1/messages, signed in with MiniMax Code's own OAuth
// device flow (PKCE S256, client mcode-public — the same flow `mcode /login`
// runs, but our own tokens: ~/.minimax is never touched). Protocol
// reverse-engineered from @magpie-community/opencode-minimax-auth 0.1.1;
// design + wire spec live in docs/minimax-code-proxy-plan.md.
// MiniMax refresh tokens are single-use — refresh discipline (single-flight,
// spent-token cache, invalid_grant classification) lives in
// open-sse/services/tokenRefresh.js refreshMiniMaxCode.

export default {
  id: "minimax-code",
  priority: 80,
  alias: "mm",
  display: {
    name: "MiniMax Code",
    icon: "smart_toy",
    color: "#FF4D4F",
    textIcon: "MM",
    website: "https://agent.minimax.cn",
  },
  category: "oauth",
  authModes: ["oauth"],
  hasOAuth: true,
  features: { usage: true },
  modelsFetcher: { url: "https://agent.minimax.cn/mavis/api/v1/models?region=cn&buildEnv=prod", type: "minimax-code" },
  transport: {
    baseUrl: "https://agent.minimax.cn/mavis/api/v1/llm/v1/messages",
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
    deviceUrl: "https://account.minimax.cn/oauth2/device/code",
    tokenUrl: "https://account.minimax.cn/oauth2/token",
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
