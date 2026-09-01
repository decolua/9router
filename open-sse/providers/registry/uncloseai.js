export default {
  id: "uncloseai",
  alias: "unc",
  hasFree: true,

  display: {
    name: "UncloseAI",
    icon: "cloud",
    textIcon: "UC",
  },

  category: "free",
  noAuth: true,

  transport: {
    baseUrl: "https://hermes.ai.unturf.com/v1/chat/completions",
    noAuth: true,
  },

  models: [
    {
      id: "adamo1139/Hermes-3-Llama-3.1-8B-FP8-Dynamic",
      name: "Hermes 3 Llama 3.1 8B FP8 Dynamic",
    },
    {
      id: "qwen3.6:27b",
      name: "Qwen3 Coder 27B",
    },
    {
      id: "gemma4:31b",
      name: "Gemma 4 31B",
    },
  ],

  serviceKinds: ["llm"],

  modelsFetcher: {
    url: "https://hermes.ai.unturf.com/v1/models",
    type: "openai",
  },

  passthroughModels: true,
};
