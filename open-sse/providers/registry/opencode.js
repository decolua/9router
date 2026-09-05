export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Zen",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
    website: "https://opencode.ai/zen",
    notice: {
      text: "7 free models via Zen — unlimited free, no credits needed. Auto-discovered via modelsFetcher.",
      apiKeyUrl: "https://opencode.ai/zen",
    },
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai/zen/v1/chat/completions",
    baseUrls: ["https://opencode.ai/zen/v1"],
    headers: {
      "x-opencode-client": "desktop",
    },
    noAuth: true,
  },
  transports: [
    { format: "openai", baseUrl: "https://opencode.ai/zen/v1/chat/completions", noAuth: true },
    { format: "claude", baseUrl: "https://opencode.ai/zen/v1/messages", noAuth: true, headers: { "x-opencode-client": "desktop" } },
    { format: "openai-responses", baseUrl: "https://opencode.ai/zen/v1/responses", noAuth: true },
  ],
  models: [
    { id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free", free: true },
    { id: "muse-spark-1.3-contributor-free", name: "Muse Spark 1.3 Contributor Free", targetFormat: "openai-responses", free: true },
    { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free", targetFormat: "openai-responses", free: true },
    { id: "mimo-v2.5-free", name: "MiMo V2.5 Free", free: true },
    { id: "ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin Free", free: true },
    { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free (550B)", free: true },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free", free: true },
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
