export default {
  id: "nube",
  alias: "nube",
  display: {
    name: "Nube.sh",
    icon: "cloud",
    color: "#2563EB",
    textIcon: "NB",
    website: "https://nube.sh",
    notice: {
      apiKeyUrl: "https://nube.sh/dashboard/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://ai.nube.sh/api/v1/chat/completions",
    validateUrl: "https://ai.nube.sh/api/v1/models",
    thinkingFormat: "openai",
  },
  models: [
    { id: "Qwen/Qwen3.5-122B-A10B", name: "Qwen 3.5 122B A10B" },
    { id: "google/gemma-4-26B-A4B-IT", name: "Gemma 4 26B A4B IT" },
    { id: "deepseek-ai/DeepSeek-V4-Flash", name: "DeepSeek V4 Flash" },
    { id: "zai-org/GLM-5.2", name: "GLM 5.2" },
    { id: "zai-org/GLM-5.1", name: "GLM 5.1" },
    { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6" },
    { id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5" },
    { id: "nube/Nube-Choice", name: "Nube Choice" },
  ],
};
