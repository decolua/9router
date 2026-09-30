export default {
  id: "llm7",
  alias: "llm7",
  aliases: [
    "llm-7",
  ],
  uiAlias: "llm7",
  display: {
    name: "LLM7",
    icon: "pool",
    color: "#7C3AED",
    textIcon: "L7",
    website: "https://llm7.io",
    notice: {
      apiKeyUrl: "https://llm7.io",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: [
    "apikey",
  ],
  transport: {
    baseUrl: "https://api.llm7.io/v1/chat/completions",
    validateUrl: "https://api.llm7.io/v1/models",
  },
  models: [
    { id: "gpt-5.5", name: "GPT-5.5 (LLM7)", contextLength: 1050000 },
    { id: "claude-opus-5", name: "Claude Opus 5 (LLM7)", contextLength: 1000000 },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash (LLM7)", contextLength: 1000000 },
    { id: "grok-4.5", name: "Grok 4.5 (LLM7)", contextLength: 500000 },
    { id: "kimi-k3", name: "Kimi K3 (LLM7)", contextLength: 1000000 },
  ],
  passthroughModels: true,
};
