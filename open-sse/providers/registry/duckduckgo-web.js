export default {
  id: "duckduckgo-web",
  alias: "ddgw",
  uiAlias: "ddgw",
  hasFree: true,

  display: {
    name: "DuckDuckGo AI Chat",
    icon: "travel_explore",
    textIcon: "DD",
  },

  category: "free",
  authType: "none",
  noAuth: true,

  transport: {
    baseUrl: "https://duck.ai/duckchat/v1/chat",
    noAuth: true,
    timeoutMs: 30000,
  },

  models: [
    {
      id: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      toolCalling: false,
    },
    {
      id: "gpt-5.6-luna",
      name: "GPT-5.6 Luna",
      toolCalling: false,
    },
    {
      id: "claude-haiku-4-5",
      name: "Claude Haiku 4.5",
      toolCalling: false,
    },
    {
      id: "mistral-small-2603",
      name: "Mistral Small 4",
      toolCalling: false,
    },
    {
      id: "tinfoil/gpt-oss-120b",
      name: "gpt-oss 120B",
      toolCalling: false,
    },
    {
      id: "tinfoil/gemma4-31b",
      name: "Gemma 4 31B",
      toolCalling: false,
    },
  ],

  serviceKinds: ["llm"],
};
