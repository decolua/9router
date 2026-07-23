export default {
  id: "workbuddy",
  // Short model prefix (wb/glm-5.2). WorkBuddy is a B2B/enterprise skin of
  // CodeBuddy CN (same codebuddy.cn backend), so models mirror codebuddy-cn.
  alias: "wb",
  uiAlias: "wb",
  hidden: false,
  priority: 90,
  display: {
    name: "WorkBuddy",
    icon: "smart_toy",
    color: "#006EFF",
    website: "https://www.codebuddy.cn",
    notice: {
      signupUrl: "https://www.codebuddy.cn",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    // Same OpenAI-compatible gateway as codebuddy-cn; platform=workbuddy is
    // distinguished at the OAuth layer, not the chat endpoint.
    baseUrl: "https://www.codebuddy.cn/v2/chat/completions",
    forceStream: true,
    thinkingFormat: "openai",
    headers: {
      "User-Agent": "CLI/2.108.1 CodeBuddy/2.108.1",
      "X-Product": "SaaS",
      "X-IDE-Type": "CLI",
      "X-IDE-Name": "CLI",
      "x-requested-with": "XMLHttpRequest",
      "x-codebuddy-request": "1",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
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
    { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash" },
    { id: "deepseek-v3-2-volc", name: "DeepSeek-V3.2" },
  ],
  oauth: {
    // Same codebuddy.cn host as codebuddy-cn; only platform param differs
    // (workbuddy vs CLI). Prefix /v2/plugin matches cockpit-tools Rust.
    baseUrl: "https://www.codebuddy.cn",
    stateUrl: "https://www.codebuddy.cn/v2/plugin/auth/state",
    tokenUrl: "https://www.codebuddy.cn/v2/plugin/auth/token",
    refreshUrl: "https://www.codebuddy.cn/v2/plugin/auth/token/refresh",
    userAgent: "CLI/2.63.2 CodeBuddy/2.63.2",
    platform: "workbuddy",
    pollInterval: 5000,
  },
  features: {
    usage: true,
    usageApikey: true,
  },
};
