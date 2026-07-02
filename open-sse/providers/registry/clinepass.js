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
      apiKeyUrl: "https://app.cline.bot/settings/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    thinkingFormat: "openai",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  models: [
    { id: "glm-5.2", name: "GLM-5.2 (ClinePass)", upstreamModelId: "cline-pass/glm-5.2" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code (ClinePass)", upstreamModelId: "cline-pass/kimi-k2.7-code" },
    { id: "kimi-k2.6", name: "Kimi K2.6 (ClinePass)", upstreamModelId: "cline-pass/kimi-k2.6" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro (ClinePass)", upstreamModelId: "cline-pass/deepseek-v4-pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash (ClinePass)", upstreamModelId: "cline-pass/deepseek-v4-flash" },
    { id: "mimo-v2.5", name: "MiMo-V2.5 (ClinePass)", upstreamModelId: "cline-pass/mimo-v2.5" },
    { id: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro (ClinePass)", upstreamModelId: "cline-pass/mimo-v2.5-pro" },
    { id: "minimax-m3", name: "MiniMax M3 (ClinePass)", upstreamModelId: "cline-pass/minimax-m3" },
    { id: "qwen3.7-max", name: "Qwen3.7 Max (ClinePass)", upstreamModelId: "cline-pass/qwen3.7-max" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus (ClinePass)", upstreamModelId: "cline-pass/qwen3.7-plus" },
  ],
  thinkingConfig: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
  },
};
