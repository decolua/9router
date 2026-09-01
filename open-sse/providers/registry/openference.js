export default {
  id: "openference",
  alias: "of",
  uiAlias: "of",

  display: {
    name: "Openference",
    icon: "hub",
    textIcon: "OF",
  },

  category: "oauth",
  authType: "oauth",
  authModes: ["oauth"],

  baseUrl:
    "https://api.openference.com/v1/chat/completions",

  responsesBaseUrl:
    "https://api.openference.com/v1/responses",

  transport: {
    baseUrl:
      "https://api.openference.com/v1/chat/completions",
  },

  oauth: {
    tokenUrl:
      "https://openference.com/oauth/token",
  },

  models: [
    {
      id: "GLM-5.2",
      name: "GLM 5.2",
      contextLength: 850000,
    },
  ],

  serviceKinds: ["llm"],
  passthroughModels: true,
};
