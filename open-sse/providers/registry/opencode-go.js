export default {
  id: "opencode-go",
  priority: 210,
  alias: "opencode-go",
  aliases: [
    "ocg",
  ],
  uiAlias: "ocg",
  display: {
    name: "OpenCode Go",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
    website: "https://opencode.ai/auth",
    notice: {
      text: "OpenCode Go subscription: $5/mo (then  0/mo). Access to Kimi, GLM, Qwen, MiMo, MiniMax models.",
      apiKeyUrl: "https://opencode.ai/auth",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://opencode.ai/zen/go/v1/chat/completions",
    headers: {},
    usage: {
      url: "https://opencode.ai/zen/go/v1/usage",
    },
  },
  models: [
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "mimo-v2.5", name: "MiMo V2.5" },
    { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
    { id: "minimax-m3", name: "MiniMax M3", targetFormat: "claude" },
    { id: "minimax-m2.7", name: "MiniMax M2.7", targetFormat: "claude" },
    { id: "minimax-m2.5", name: "MiniMax M2.5", targetFormat: "claude" },
    { id: "qwen3.7-max", name: "Qwen 3.7 Max", targetFormat: "claude" },
    { id: "qwen3.7-plus", name: "Qwen 3.7 Plus", targetFormat: "claude" },
    { id: "qwen3.6-plus", name: "Qwen 3.6 Plus", targetFormat: "claude" },
  ],
  features: {
    // Go is a subscription with rolling/weekly/monthly windows, but it authenticates
    // with a plain API key (category "apikey"), so usageApikey is required for the
    // /api/usage route to accept the connection.
    usage: true,
    usageApikey: true,
  },
};
