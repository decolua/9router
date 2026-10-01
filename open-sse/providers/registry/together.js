export default {
  id: "together",
  priority: 60,
  alias: "together",
  display: {
    name: "Together AI",
    icon: "group_work",
    color: "#0F6FFF",
    textIcon: "TG",
    website: "https://www.together.ai",
    notice: {
      apiKeyUrl: "https://api.together.xyz/settings/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.together.xyz/v1/chat/completions",
    validateUrl: "https://api.together.xyz/v1/models",
  },
  models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo" },
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
    { id: "Qwen/Qwen3-235B-A22B", name: "Qwen3 235B" },
    { id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", name: "Llama 4 Maverick" },
    { id: "BAAI/bge-large-en-v1.5", name: "BGE Large EN v1.5", kind: "embedding" },
    { id: "togethercomputer/m2-bert-80M-8k-retrieval", name: "M2 BERT 80M 8K", kind: "embedding" },
  ],
  serviceKinds: ["llm", "embedding"],
  embeddingConfig: { baseUrl: "https://api.together.xyz/v1/embeddings" },
};
