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
  },
  models: [
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "glm-5", name: "GLM 5" },
    { id: "qwen3.5-plus", name: "Qwen 3.5 Plus" },
    { id: "qwen3.6-plus", name: "Qwen 3.6 Plus" },
    { id: "mimo-v2-pro", name: "MiMo V2 Pro" },
    { id: "mimo-v2-omni", name: "MiMo V2 Omni" },
    { id: "minimax-m2.7", name: "MiniMax M2.7", targetFormat: "claude" },
    { id: "minimax-m2.5", name: "MiniMax M2.5", targetFormat: "claude" },
  ],
};
