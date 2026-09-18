export default {
  id: "ainetcafe",
  alias: "ainetcafe",
  display: {
    name: "ainetcafe",
    icon: "bolt",
    color: "#32FEA5",
    textIcon: "AI",
    website: "https://ainetcafe.com/k3/",
    notice: {
      text: "Kimi K3 served from ainetcafe's own cluster at native MXFP4, plus other open and commercial models at published per-token prices.",
      apiKeyUrl: "https://microquickjs.com/register?lng=en",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://microquickjs.com/v1/chat/completions",
    validateUrl: "https://microquickjs.com/v1/models",
  },
  // Seed snapshot from live /v1/models (2026-09-16). The current catalogue is
  // fetched from the same endpoint; other ids are accepted via passthroughModels.
  models: [
    { id: "Kimi-K3", name: "Kimi K3" },
    { id: "GLM5.2", name: "GLM 5.2" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "MiniMax-H3", name: "MiniMax H3" },
  ],
  modelsFetcher: { url: "https://microquickjs.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
