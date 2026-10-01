export default {
  id: "venice",
  priority: 115,
  alias: "venice",
  aliases: [
    "vn",
  ],
  uiAlias: "venice",
  display: {
    name: "Venice AI",
    icon: "shield",
    color: "#DC2626",
    textIcon: "VE",
    website: "https://venice.ai",
    notice: {
      text: "OpenAI-compatible. Private inference + uncensored models (Venice Uncensored, GLM, Qwen, DeepSeek, Llama).",
      apiKeyUrl: "https://venice.ai/settings/api",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.venice.ai/api/v1/chat/completions",
    validateUrl: "https://api.venice.ai/api/v1/models",
    thinkingFormat: "openai",
  },
  // Curated seed; the full live catalogue (90+ text models) is fetched via
  // modelsFetcher and any other id is accepted via passthroughModels.
  models: [
    { id: "venice-uncensored-1-2", name: "Venice Uncensored 1.2" },
    { id: "zai-org-glm-5", name: "GLM-5" },
    { id: "qwen3-235b-a22b-instruct-2507", name: "Qwen3 235B A22B Instruct" },
    { id: "qwen3-coder-480b-a35b-instruct-turbo", name: "Qwen3 Coder 480B A35B Turbo" },
    { id: "qwen3-vl-235b-a22b", name: "Qwen3 VL 235B A22B" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "llama-3.3-70b", name: "Llama 3.3 70B" },
    { id: "hermes-3-llama-3.1-405b", name: "Hermes 3 Llama 3.1 405B" },
    { id: "mistral-small-3-2-24b-instruct", name: "Mistral Small 3.2 24B" },
    { id: "text-embedding-3-large", name: "Text Embedding 3 Large", kind: "embedding" },
    { id: "text-embedding-bge-m3", name: "BGE-M3 Embedding", kind: "embedding" },
    { id: "text-embedding-qwen3-8b", name: "Qwen3 8B Embedding", kind: "embedding" },
    { id: "venice-sd35", name: "Venice SD3.5", params: ["n", "size"], kind: "image" },
    { id: "flux-2-pro", name: "FLUX.2 Pro", params: ["n", "size"], kind: "image" },
    { id: "gpt-image-2", name: "GPT Image 2 (via Venice)", params: ["n", "size", "quality"], kind: "image" },
  ],
  serviceKinds: ["llm", "embedding", "image"],
  embeddingConfig: {
    baseUrl: "https://api.venice.ai/api/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
  },
  imageConfig: {
    baseUrl: "https://api.venice.ai/api/v1/images/generations",
  },
  modelsFetcher: { url: "https://api.venice.ai/api/v1/models", type: "openai" },
  passthroughModels: true,
};
