export default {
  id: "chipotle",
  alias: "pepper",
  uiAlias: "pepper",
  hasFree: true,

  display: {
    name: "Chipotle AI",
    icon: "restaurant",
    textIcon: "CP",
  },

  category: "free",
  authType: "none",
  noAuth: true,

  transport: {
    baseUrl: "https://amelia.chipotle.com",
    noAuth: true,
  },

  models: [
    {
      id: "pepper-1",
      name: "Pepper (Chipotle AI 🌯)",
      toolCalling: false,
    },
  ],

  serviceKinds: ["llm"],
  passthroughModels: true,
};
