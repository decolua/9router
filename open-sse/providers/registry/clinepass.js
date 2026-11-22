export default {
  id: "clinepass",
  priority: 85,
  alias: "clinepass",
  uiAlias: "clinepass",
  display: {
    name: "ClinePass",
    icon: "vpn_key",
    color: "#5B9BD5",
    textIcon: "CP",
    website: "https://cline.bot",
    notice: {
      signupUrl: "https://app.cline.bot",
    },
  },
  category: "oauth",
  // ClinePass authenticates with a plain API key from app.cline.bot/settings/api-keys
  // (category "apikey"). The OAuth extension flow used by Cline does not issue
  // tokens that the ClinePass API consumer endpoint accepts (HTTP 401) - see #2333.
  authModes: ["apikey", "oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    },
    // Non-stream chat completions come back wrapped in {"success":true,"data":{...}}
    quirks: { clineEnvelope: true },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      hooks: [
        "clineHeaders",
      ],
    },
  },
  models: [
    { id: "cline-pass/deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 Flash 1017 (ClinePass)" },
    { id: "cline-pass/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash (ClinePass)" },
    { id: "cline-pass/glm-5.3-flash", name: "GLM 5.3 Flash (ClinePass)" },
    { id: "cline-pass/glm-5.3", name: "GLM 5.3 (ClinePass)" },
    { id: "cline-pass/kimi-k3.1-pro", name: "Kimi K3.1 Pro (ClinePass)" },
    { id: "cline-pass/kimi-k3", name: "Kimi K3 (ClinePass)" },
    { id: "cline-pass/muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor (ClinePass)" },
    { id: "cline-pass/minimax-m3.1-flash", name: "MiniMax M3.1 Flash (ClinePass)" },
    { id: "cline-pass/mimo-v2.6-pro", name: "MiMo V2.6 Pro (ClinePass)" },
    { id: "cline-pass/mimo-v2.6-flash", name: "MiMo V2.6 Flash (ClinePass)" },
    { id: "cline-pass/qwen3.8-max", name: "Qwen3.8 Max (ClinePass)" },
    { id: "cline-pass/qwen3.7-max", name: "Qwen3.7 Max (ClinePass)" },
    { id: "cline-pass/qwen3.7-plus", name: "Qwen3.7 Plus (ClinePass)" },
  ],
  oauth: {
    appBaseUrl: "https://app.cline.bot",
    apiBaseUrl: "https://api.cline.bot",
    authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
    tokenUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
  },
  thinkingConfig: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
  },
};
