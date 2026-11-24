export default {
  id: "atlascloud",
  alias: "atlascloud",
  aliases: ["ac"],
  display: {
    name: "Atlas Cloud",
    icon: "cloud_queue",
    color: "#6D5EF5",
    textIcon: "AC",
    website: "https://www.atlascloud.ai",
    notice: {
      text: "OpenAI-compatible gateway. 100+ models (DeepSeek, Kimi, GLM, Qwen, MiniMax, Claude, GPT, Gemini).",
      apiKeyUrl: "https://console.atlascloud.ai/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.atlascloud.ai/v1/chat/completions",
    validateUrl: "https://api.atlascloud.ai/v1/models",
    thinkingFormat: "openai",
  },
  // Seed snapshot from live /v1/models. The full catalogue is fetched via
  // modelsFetcher; other ids are still accepted via passthroughModels.
  models: [
    { id: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-ai/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "moonshotai/kimi-k3", name: "Kimi K3" },
    { id: "moonshotai/kimi-k2.6", name: "Kimi K2.6" },
    { id: "zai-org/glm-5.2", name: "GLM 5.2" },
    { id: "zai-org/glm-5.1", name: "GLM 5.1" },
    { id: "qwen/qwen3.8-max", name: "Qwen 3.8 Max" },
    { id: "qwen/qwen3.5-397b-a17b", name: "Qwen 3.5 397B A17B" },
    { id: "minimaxai/minimax-m3", name: "MiniMax M3" },
  ],
  modelsFetcher: { url: "https://api.atlascloud.ai/v1/models", type: "openai" },
  passthroughModels: true,
};
