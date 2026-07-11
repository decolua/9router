export default {
  id: "ollama",
  priority: 30,
  hasFree: true,
  alias: "ollama",
  display: {
    name: "Ollama Cloud",
    icon: "cloud",
    color: "#ffffffff",
    textIcon: "OL",
    website: "https://ollama.com",
    notice: {
      text: "Free tier: light usage, 1 cloud model at a time (limits reset every 5h & 7d). Pro $20/mo · Max $100/mo.",
      apiKeyUrl: "https://ollama.com/settings/keys",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://ollama.com/api/chat",
    validateUrl: "https://ollama.com/api/tags",
    format: "ollama",
  },
  models: [
    { id: "gpt-oss:120b", name: "GPT OSS 120B" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "glm-5", name: "GLM 5" },
    { id: "minimax-m2.5", name: "MiniMax M2.5" },
    { id: "glm-4.7-flash", name: "GLM 4.7 Flash" },
    { id: "qwen3.5", name: "Qwen3.5" },
    { id: "glm-5.2:cloud", name: "GLM 5.2 Cloud" },
    { id: "kimi-k2.7-code:cloud", name: "Kimi K2.7 Code Cloud" },
    { id: "minimax-m3:cloud", name: "MiniMax M3 Cloud" },
    { id: "nemotron-3-super:cloud", name: "Nemotron 3 Super Cloud" },
  ],
  serviceKinds: ["llm"],
  features: {
    usage: true,
  },
};
