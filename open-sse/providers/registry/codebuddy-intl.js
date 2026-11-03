// WorkBuddy AI international (workbuddy.ai) — mirrors codebuddy-cn registry
// shape, swapping the Tencent CN domain for the .ai endpoint set. All
// OAuth/plugin URLs use the /v2/plugin prefix with platform=ide (CN uses
// platform=CLI).
//
// The identity headers below are the ones the official 5.8.4 desktop client
// puts on POST /v2/chat/completions. Chat goes out through the client's
// bundled CLI sub-process, whose env sets CLIENT_INFO_PLATFORM/IDE_TYPE to
// "WorkBuddy" while applicationName still resolves to "workbuddy-ai" from
// product.json — hence the mixed-case UA (`WorkBuddy/<ver> workbuddy-ai/<ver>
// CLI/<cli>`). The Electron main process sends a different, all-lowercase UA on
// its side channels (msg-center / conversations); that one does not belong on
// chat requests.
export default {
  id: "codebuddy-intl",
  alias: "cbai",
  uiAlias: "cbai",
  hidden: false,
  priority: 90,
  display: {
    name: "CodeBuddy",
    icon: "smart_toy",
    color: "#006EFF",
    website: "https://www.codebuddy.ai",
    notice: {
      signupUrl: "https://www.codebuddy.ai",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    // Chat gateway is OpenAI-compatible SSE (same /v2/chat/completions path as CN).
    baseUrl: "https://www.workbuddy.ai/v2/chat/completions",
    forceStream: true,
    // CodeBuddy intl speaks the same unified OpenAI reasoning_effort shape as CN.
    thinkingFormat: "openai",
    headers: {
      "User-Agent": "WorkBuddy/5.8.4 workbuddy-ai/5.8.4 CLI/2.161.0",
      "X-Product": "SaaS",
      "X-IDE-Type": "WorkBuddy",
      "X-IDE-Name": "WorkBuddy",
      "X-IDE-Version": "5.8.4",
      "X-Private-Data": "true",
      "X-Agent-Intent": "craft",
      "X-Agent-Purpose": "conversation",
      "X-Agent-Type": "main",
      "X-Domain": "www.workbuddy.ai",
      "x-requested-with": "XMLHttpRequest",
      "x-codebuddy-request": "1",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      // Channel check requires the plugin's request/conversation ids — without
      // them upstream rejects with 400 / 11128 "request illegal".
      hooks: ["codebuddyHeaders"],
    },
    // Intl billing endpoint mirrors CN shape (data.Response.Data.Accounts[]).
    usage: {
      url: "https://www.workbuddy.ai/v2/billing/meter/get-user-resource",
    },
  },
  // Same model lineup exposed by the CN gateway — intl backend is the same catalog.
  models: [
    { id: "glm-5.2", name: "GLM-5.2" },
    { id: "glm-5.1", name: "GLM-5.1" },
    { id: "glm-5.0", name: "GLM-5.0" },
    { id: "glm-5.0-turbo", name: "GLM-5.0-Turbo" },
    { id: "glm-5v-turbo", name: "GLM-5v-Turbo" },
    { id: "glm-4.7", name: "GLM-4.7" },
    { id: "minimax-m3", name: "MiniMax-M3" },
    { id: "minimax-m2.7", name: "MiniMax-M2.7" },
    { id: "kimi-k2.7", name: "Kimi-K2.7-Code" },
    { id: "kimi-k2.6", name: "Kimi-K2.6" },
    { id: "kimi-k2.5", name: "Kimi-K2.5" },
    { id: "hy3-preview", name: "Hy3 Preview" },
    { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
    // deepseek-v4-flash replaced server-side by deepseek-v4.1-flash (same
    // catalog as CN; the old endpoint still answers 200 but the list is the contract).
    { id: "deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash" },
    { id: "deepseek-v3-2-volc", name: "DeepSeek-V3.2" },
  ],
  oauth: {
    baseUrl: "https://www.codebuddy.ai",
    stateUrl: "https://www.codebuddy.ai/v2/plugin/auth/state",
    tokenUrl: "https://www.codebuddy.ai/v2/plugin/auth/token",
    refreshUrl: "https://www.codebuddy.ai/v2/plugin/auth/token/refresh",
    userAgent: "IDE/2.63.2 CodeBuddy/2.63.2",
    platform: "ide",
    pollInterval: 5000,
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
