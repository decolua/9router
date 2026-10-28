export default {
  id: "dahl",
  priority: 120,
  alias: "dahl",
  aliases: [
    "dahl-inference",
  ],
  uiAlias: "dahl",
  display: {
    name: "Dahl Inference",
    icon: "hub",
    color: "#1E40AF",
    textIcon: "DH",
    website: "https://dahl.global",
    notice: {
      text: "OpenAI-compatible Gonka inference node. Small, fixed catalogue (GLM-5.3-Flash, DeepSeek-V4-Flash, MiniMax-M2.7) at a flat per-token rate.",
      apiKeyUrl: "https://dahl.global/dashboard",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://inference.dahl.global/v1/chat/completions",
    validateUrl: "https://inference.dahl.global/v1/models",
  },
  // The live catalogue is public (no auth), so modelsFetcher works without a key
  // and the ids below are a convenience seed rather than an exhaustive list.
  models: [
    { id: "zai-org/GLM-5.3-Flash", name: "GLM-5.3 Flash" },
    { id: "deepseek-ai/DeepSeek-V4-Flash-0731", name: "DeepSeek V4 Flash 0731" },
    { id: "MiniMaxAI/MiniMax-M2.7", name: "MiniMax M2.7" },
  ],
  modelsFetcher: { url: "https://inference.dahl.global/v1/models", type: "openai" },
  passthroughModels: true,
};
