export default {
  id: "llmtr",
  priority: 65,
  alias: "llmtr",
  aliases: [
    "lt",
  ],
  uiAlias: "lt",
  display: {
    name: "LLMTR",
    icon: "public",
    color: "#121E40",
    textIcon: "LT",
    website: "https://llmtr.com",
    notice: {
      apiKeyUrl: "https://llmtr.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://llmtr.com/v1/chat/completions",
    // Chat `reasoning` is a boolean. An object is rejected.
    thinkingFormat: "llmtr",
  },
  // Seed only. The live catalogue is ~380 ids (`vendor/name`, and first-party
  // `llmtr/<name>`). Any other id is accepted via passthroughModels.
  // Request them as `llmtr/<id>` so the leading vendor segment is not parsed
  // as the provider: `llmtr/qwen/qwen3.8-27b-free`, `llmtr/llmtr/qwen3-8-27b`.
  models: [
    { id: "qwen/qwen3.8-27b-free", name: "Qwen3.8 27B (free)" },
    { id: "llmtr/qwen3-8-27b", name: "Qwen 3.8 27B" },
  ],
  passthroughModels: true,
};
