export default {
  id: "atmorouter",
  alias: "atmorouter",
  aliases: ["atmo"],
  display: {
    name: "AtmoRouter",
    icon: "bolt",
    color: "#09090B",
    textIcon: "AR",
    website: "https://atmorouter.dev",
    notice: {
      text: "OpenAI-compatible gateway (Claude, GPT, Gemini, GLM, Kimi, Qwen, DeepSeek). Model ids are family-prefixed, e.g. cc/claude-sonnet-4-6 or cbcn/glm-5.3.",
      apiKeyUrl: "https://atmorouter.dev",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://atmorouter.dev/v1/chat/completions",
    validateUrl: "https://atmorouter.dev/v1/models",
    thinkingFormat: "openai",
  },
  // Seed snapshot from the public /v1/models. The full catalogue is fetched via
  // modelsFetcher; other ids are still accepted via passthroughModels.
  models: [
    { id: "cc/claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "cc/claude-opus-4-7", name: "Claude Opus 4.7" },
    { id: "cx/gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "cb/gemini-3.1-pro", name: "Gemini 3.1 Pro" },
    { id: "cbcn/glm-5.3", name: "GLM 5.3" },
    { id: "ali/kimi-k2.7-code", name: "Kimi K2.7 Code" },
    { id: "ali/qwen3.8-max", name: "Qwen 3.8 Max" },
    { id: "ali/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
  ],
  modelsFetcher: { url: "https://atmorouter.dev/v1/models", type: "openai" },
  passthroughModels: true,
};
