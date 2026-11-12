export default {
  id: "uberllm",
  priority: 120,
  alias: "uberllm",
  aliases: [
    "ull",
  ],
  uiAlias: "ull",
  display: {
    name: "UberLLM",
    icon: "hub",
    color: "#2563EB",
    textIcon: "UL",
    website: "https://uberllm.dev",
    notice: {
      text: "OpenAI-compatible gateway. One prepaid API key for chat and image models; model ids are vendor-prefixed (e.g. anthropic/claude-sonnet-5, deepseek/deepseek-v4.1-flash) and are fetched live from the provider.",
      apiKeyUrl: "https://uberllm.dev/signup",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.uberllm.dev/v1/chat/completions",
    // /v1/models answers without a key, so the authenticated balance endpoint
    // is used to tell a good key (200) from a bad one (401).
    validateUrl: "https://api.uberllm.dev/v1/balance",
    thinkingFormat: "openai",
    retry: {
      429: 2,
    },
  },
  // Curated seed; the live catalogue is fetched via modelsFetcher and any other
  // id is accepted via passthroughModels.
  models: [
    { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "openai/gpt-6-sol", name: "GPT-6 Sol" },
    { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash" },
    { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "z-ai/glm-5.3", name: "GLM 5.3" },
    { id: "moonshotai/kimi-k3", name: "Kimi K3" },
    { id: "qwen/qwen3.8-flash", name: "Qwen3.8 Flash" },
    { id: "black-forest-labs/flux.2-klein-4b", name: "FLUX.2 Klein 4B", params: ["n", "size"], kind: "image" },
    { id: "bytedance/seedream-4.5", name: "Seedream 4.5", params: ["n", "size"], kind: "image" },
    { id: "venice/z-image-turbo", name: "Z-Image Turbo", params: ["n", "size"], kind: "image" },
  ],
  serviceKinds: ["llm", "image"],
  imageConfig: { baseUrl: "https://api.uberllm.dev/v1/images/generations" },
  modelsFetcher: { url: "https://api.uberllm.dev/v1/models", type: "openai" },
  passthroughModels: true,
};
