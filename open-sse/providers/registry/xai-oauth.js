export default {
  id: "xai-oauth",
  alias: "xao",
  uiAlias: "xao",

  display: {
    name: "xAI OAuth",
    icon: "bolt",
    textIcon: "xAI",
  },

  category: "oauth",
  authType: "oauth",
  authModes: ["oauth"],

  baseUrl:
    "https://api.x.ai/v1/chat/completions",

  responsesBaseUrl:
    "https://api.x.ai/v1/responses",

  transport: {
    baseUrl:
      "https://api.x.ai/v1/chat/completions",
  },

  oauth: {
    tokenUrl:
      "https://auth.x.ai/oauth2/token",
  },

  models: [
    {
      id: "grok-4.5",
      name: "Grok 4.5",
      contextLength: 500000,
      targetFormat: "openai-responses",
    },
    {
      id: "grok-4.6",
      name: "Grok 4.6",
      contextLength: 500000,
      supportsReasoning: true,
      supportsVision: true,
      supportsXHighEffort: true,
      toolCalling: true,
      targetFormat: "openai-responses",
    },
    {
      id: "grok-4.3",
      name: "Grok 4.3",
    },
    {
      id: "grok-build-0.1",
      name: "Grok Build 0.1",
      contextLength: 256000,
    },
    {
      id: "grok-4.20-multi-agent-0309",
      name: "Grok 4.20 Multi Agent",
      targetFormat: "openai-responses",
    },
    {
      id: "grok-4.20-0309-reasoning",
      name: "Grok 4.20 Reasoning",
    },
    {
      id: "grok-4.20-0309-non-reasoning",
      name: "Grok 4.20",
    },
  ],

  serviceKinds: ["llm"],
  passthroughModels: true,
};
