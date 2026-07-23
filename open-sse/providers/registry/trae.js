// Trae (ByteDance marscode) provider registry entry.
// Auth + exchange URLs verified from cockpit-tools/src-tauri/src/modules/trae_oauth.rs.
// Region origins verified from trae_account.rs lines 63-66.
// Chat endpoint path /cloudide/api/v3/trae/Chat is GUESSED (TODO verify upstream).
export default {
  id: "trae",
  alias: "tr",
  uiAlias: "tr",
  aliases: ["marscode"],
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,
  authModes: ["oauth"],
  display: {
    name: "Trae",
    icon: "bolt",
    color: "#FF6A00",
    textIcon: "TR",
    website: "https://www.trae.ai",
    notice: { signupUrl: "https://www.trae.ai" },
  },
  transport: {
    // IDE flow (cockpit-tools verified): x-cloudide-token auth, OpenAI-shaped SSE.
    baseUrl: "https://api.marscode.com/cloudide/api/v3/trae/Chat",
    format: "openai",
    headers: {
      "x-app-version": "3.5.54",
      "x-app-type": "stable",
      "x-env": "production",
      "client_id": "ono9krqynydwx5",
      "User-Agent": "Trae/1.0.0 antigravity-cockpit-tools",
    },
    // Auth: x-cloudide-token + Authorization: Bearer — injected by executor buildHeaders.
    auth: {
      combined: true,
      header: "x-cloudide-token",
      scheme: "raw",
    },
    usage: {
      url: "https://api.marscode.com/cloudide/api/v3/trae/GetUserInfo",
    },
    regions: {
      cn: "https://api.marscode.com",
      sg: "https://api.trae.ai",
      us: "https://www.trae.ai",
    },
    defaultRegion: "cn",
  },
  oauth: {
    clientId: "ono9krqynydwx5",
    clientSecret: "-",
    platform: "trae",
    pollInterval: 1500,
    // Login guidance returns LoginHost for browser open.
    loginGuidanceUrl: "https://api.marscode.com/cloudide/api/v3/trae/GetLoginGuidance",
    // ExchangeToken: refresh -> access (POST JSON, body below).
    tokenUrl: "https://api.marscode.com/cloudide/api/v3/trae/oauth/ExchangeToken",
    exchangeTokenUrl: "https://api.marscode.com/cloudide/api/v3/trae/oauth/ExchangeToken",
    refreshUrl: "https://api.marscode.com/cloudide/api/v3/trae/oauth/ExchangeToken",
    userInfoUrl: "https://api.marscode.com/cloudide/api/v3/trae/GetUserInfo",
    // Trae refresh uses custom JSON body, not OAuth form — handled by refresh.js, not config-driven.
    refresh: { encoding: "json" },
  },
  // Model catalog sourced from OmniRoute (IDE flow, core-normal.trae.ai).
  models: [
    { id: "auto", name: "Auto (Server Picks)" },
    { id: "work", name: "Work (Fast)" },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "gemini-3-flash-solo", name: "Gemini 3 Flash" },
    { id: "minimax-m3", name: "MiniMax M3" },
    { id: "minimax-m2.7", name: "MiniMax M2.7" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "gpt-5.4", name: "GPT 5.4" },
    { id: "gpt-5.2", name: "GPT 5.2" },
  ],
  features: { usage: true },
};
