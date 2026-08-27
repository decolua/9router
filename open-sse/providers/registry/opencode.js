export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    format: "openai-responses",
    forceStream: true,
    headers: {
      "x-opencode-client": "desktop",
    },
    noAuth: true,
  },
  models: [
    { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free" },
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
