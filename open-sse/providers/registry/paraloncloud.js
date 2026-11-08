export default {
  id: "paraloncloud",
  priority: 165,
  alias: "paraloncloud",
  aliases: [
    "paralon",
  ],
  uiAlias: "paralon",
  display: {
    name: "ParalonCloud",
    icon: "cloud",
    color: "#2EE6A6",
    textIcon: "PC",
    website: "https://paraloncloud.com",
    notice: {
      apiKeyUrl: "https://paraloncloud.com/console",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://paraloncloud.com/v1/chat/completions",
    validateUrl: "https://paraloncloud.com/v1/models",
  },
  models: [
    { id: "qwen3.8-27b", name: "Qwen3.8 27B" },
    { id: "qwen3-3b", name: "Qwen3 4B" },
    { id: "multilingual-e5-small", name: "Multilingual E5 Small", kind: "embedding" },
  ],
  serviceKinds: ["llm", "embedding"],
  embeddingConfig: { baseUrl: "https://paraloncloud.com/v1/embeddings" },
};
