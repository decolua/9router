export default {
  id: "novita",
  priority: 70,
  alias: "novita",
  display: {
    name: "Novita AI",
    icon: "cloud",
    color: "#7C3AED",
    textIcon: "NV",
    website: "https://novita.ai",
    notice: {
      apiKeyUrl: "https://novita.ai/settings/key-management",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.novita.ai/openai/v1/chat/completions",
    validateUrl: "https://api.novita.ai/openai/v1/models",
  },
  models: [
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "qwen/qwen3-coder-480b-a35b-instruct", name: "Qwen3 Coder 480B" },
    { id: "moonshotai/kimi-k3", name: "Kimi K3" },
    { id: "zai-org/glm-5.2", name: "GLM 5.2" },
  ],
};
