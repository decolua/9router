export default {
  id: "aihorde",
  alias: "aih",
  uiAlias: "aih",
  hasFree: true,

  display: {
    name: "AI Horde",
    icon: "hub",
    textIcon: "AH",
    website: "https://aihorde.net",
  },

  // AI Horde works without an account by using its documented
  // anonymous key. A configured account key remains optional and
  // is preferred by the provider-specific executor when present.
  category: "free",
  noAuth: true,
  authModes: ["apikey"],

  serviceKinds: ["llm"],

  transport: {
    baseUrl: "https://oai.aihorde.net/v1/chat/completions",
    noAuth: true,

    // Volunteer-worker queue latency is materially higher than
    // normal providers. BaseExecutor already consumes config.timeoutMs.
    timeoutMs: 120000,
  },

  models: [
    {
      id: "aphrodite/TheDrummer/Cydonia-24B-v4.3",
      name: "Cydonia 24B (AI Horde)",
      contextLength: 32768,
      toolCalling: false,
      unsupportedParams: [
        "tools",
        "tool_choice",
        "parallel_tool_calls",
      ],
    },
    {
      id: "aphrodite/TheDrummer/Skyfall-31B-v4.2",
      name: "Skyfall 31B (AI Horde)",
      contextLength: 32768,
      toolCalling: false,
      unsupportedParams: [
        "tools",
        "tool_choice",
        "parallel_tool_calls",
      ],
    },
    {
      id: "google/gemma-4-31b",
      name: "Gemma 4 31B (AI Horde)",
      contextLength: 32768,
      toolCalling: false,
      unsupportedParams: [
        "tools",
        "tool_choice",
        "parallel_tool_calls",
      ],
    },
  ],

  // Live worker/model availability changes continuously.
  // Keep upstream model IDs untouched.
  modelsFetcher: {
    url: "https://oai.aihorde.net/v1/models",
    type: "openai",
  },

  passthroughModels: true,
};
