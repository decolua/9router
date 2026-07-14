export default {
  id: "freebuff",
  priority: 35,
  alias: "fb",
  uiAlias: "fb",
  display: {
    name: "Freebuff",
    icon: "bolt",
    color: "#10B981",
    website: "https://www.codebuff.com/",
    notice: {
      signupUrl: "https://www.codebuff.com/",
    },
  },
  category: "oauth",
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
  ],
};
