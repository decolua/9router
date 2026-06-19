export default {
  id: "freebuff",
  priority: 160,
  alias: "fb",
  uiAlias: "fb",
  display: {
    name: "Freebuff AI",
    icon: "smart_toy",
    color: "#000000",
    website: "https://freebuff.com",
    notice: {
      signupUrl: "https://freebuff.com",
    },
  },
  category: "oauth",
  hasOAuth: true,
  transport: {
    baseUrl: "https://www.codebuff.com/api/v1/chat/completions",
    format: "openai",
    headers: {
      "User-Agent": "ai-sdk/openai-compatible/1.0.25/codebuff",
    },
  },
  models: [
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "minimax/minimax-m2.7", name: "MiniMax M2.7" },
    { id: "minimax/minimax-m3", name: "MiniMax M3" },
    { id: "mimo/mimo-v2.5", name: "MiMo V2.5" },
    { id: "mimo/mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
  ],
};
