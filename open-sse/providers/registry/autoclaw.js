// AutoClaw — Z.ai's GLM proxy gateway. OpenAI-compatible upstream that selects
// the model via the X-Request-Model header (body "model" is ignored upstream).
// Auth is a Google OAuth → JWT access_token flow with app-signing headers on refresh.
// Spec: https://raw.githubusercontent.com/yoymiya/atxlaw/refs/heads/main/re-atclaw.md
export default {
  id: "autoclaw",
  alias: "aclaw",
  uiAlias: "aclaw",
  priority: 120,
  display: {
    name: "AutoClaw",
    icon: "autoclaw",
    color: "#FF6B35",
    textIcon: "AC",
    website: "https://autoclaw.com",
    notice: {
      signupUrl: "https://autoclaw.com",
    },
  },
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,
  authModes: ["oauth", "apikey"],
  transport: {
    // LLM proxy contract — model is chosen by X-Request-Model header, not body.
    baseUrl:
      "https://autoglm-api.autoglm.ai/autoclaw-proxy/proxy/autoclaw/chat/completions",
    format: "openai",
    // DeepSeek-backed labels 500 on stream:false — always stream upstream, re-aggregate
    // for non-streaming clients (handled by executor + chatCore).
    forceStream: true,
    // Auth uses X-Authorization (not the standard Authorization header) — handled by executor.
    auth: {
      combined: true,
      header: "X-Authorization",
      scheme: "bearer",
    },
    headers: {
      "Content-Type": "application/json",
    },
    // Wallet/ledger usage endpoint (reward points balance).
    usage: {
      url: "https://autoglm-api.autoglm.ai/agent-assetmgr/api/v2/wallets?biz_app_id=autoclaw",
    },
  },
  // Verified model substitution table (label ≠ served model). Only the working
  // labels are exposed; dead labels (zai_glm-4.x, zai_glm-5, zai_glm-5.2,
  // huawei_glm-5) are omitted — they 400/404 for this account class.
  models: [
    {
      id: "openrouter_glm-5.2",
      name: "GLM-5.2 (OpenRouter)",
      upstreamModelId: "openrouter_glm-5.2",
    },
    {
      id: "zai_glm-5-turbo",
      name: "GLM-5 Turbo",
      upstreamModelId: "zai_glm-5-turbo",
    },
    {
      id: "zai_glm-5v-turbo",
      name: "GLM-5V Turbo",
      upstreamModelId: "zai_glm-5v-turbo",
    },
    { id: "zai_glm-5.1", name: "GLM-5.1", upstreamModelId: "zai_glm-5.1" },
    {
      id: "zai_pony-alpha-2",
      name: "Pony Alpha 2",
      upstreamModelId: "zai_pony-alpha-2",
    },
    { id: "zai_auto", name: "Auto (DeepSeek)", upstreamModelId: "zai_auto" },
  ],
  oauth: {
    // AutoClaw app signing credentials (baked into the desktop client, forgeable).
    appId: "100003",
    appKey: "38d2391985e2369a5fb8227d8e6cd5e5",
    // Google OAuth client (overseas login).
    clientId:
      "1070296600523-gjj3c53agiq47m32ad4juolgfae88tdi.apps.googleusercontent.com",
    // User API base — OAuth + refresh live here.
    baseUrl: "https://autoglm-api.autoglm.ai",
    authorizeUrl:
      "https://autoglm-api.autoglm.ai/userapi/overseasv1/google-oauth-url",
    tokenUrl:
      "https://autoglm-api.autoglm.ai/userapi/overseasv1/google-oauth-login",
    refreshUrl: "https://autoglm-api.autoglm.ai/userapi/v1/refresh",
    userInfoUrl: "https://autoglm-api.autoglm.ai/userapi/v1/user-profile",
    redirectUri: "http://localhost:18432/auth/callback-google",
    callbackPath: "/auth/callback-google",
    fixedPort: 18432,
    sourceId: "autoclaw",
    // access_token TTL = 24h; refresh proactively.
    refreshLeadMs: 3600 * 1000,
  },
  features: {
    // usage/usageApikey tetap true supaya /api/usage/[id] route izinkan fetch
    // balance (dipakai inline di connection row). Halaman Quota Tracker
    // (/dashboard/usage) di-hide untuk autoclaw via UI-level filter.
    usage: true,
    usageApikey: true,
  },
};
