export default {
  id: "nube-sh",
  priority: 116,
  alias: "nube",
  uiAlias: "nube",
  display: {
    name: "Nube.sh",
    icon: "cloud",
    color: "#0EA5E9",
    textIcon: "NB",
    website: "https://nube.sh",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://ai.nube.sh/api/v1/chat/completions",
    validateUrl: "https://ai.nube.sh/api/v1/models",
  },
  models: [
    { id: "Qwen3.5-122B-A10B", name: "Qwen3.5 122B A10B" },
    { id: "Gemma-4-26B-A4B-IT", name: "Gemma 4 26B A4B IT" },
    { id: "DeepSeek-V4-Flash", name: "DeepSeek V4 Flash" },
    { id: "GLM-5.2", name: "GLM 5.2" },
    { id: "GLM-5.1", name: "GLM 5.1" },
    { id: "Kimi-K2.6", name: "Kimi K2.6" },
    { id: "Kimi-K2.5", name: "Kimi K2.5" },
    { id: "Nube-Choice", name: "Nube Choice" },
  ],
};
