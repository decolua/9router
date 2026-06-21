export default {
  id: "sensenova",
  priority: 75,
  alias: "sensenova",
  aliases: [
    "sn",
  ],
  uiAlias: "sn",
  display: {
    name: "SenseNova",
    icon: "cloud",
    color: "#1A73E8",
    textIcon: "SN",
    website: "https://platform.sensenova.cn",
    notice: {
      text: "Free tier: 1,500 calls/model per 5h (excl. special models). SenseNova 6.7 Flash-Lite & U1 Fast. Supports Cowork-Skills, Hermes Agent & OpenClaw. Max 20 API keys.",
      apiKeyUrl: "https://platform.sensenova.cn",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://token.sensenova.cn/v1/chat/completions",
    headers: {},
  },
  models: [
    { id: "SenseNova-6.7-Flash-Lite", name: "SenseNova 6.7 Flash-Lite" },
    { id: "SenseNova-U1-Fast", name: "SenseNova U1 Fast" },
  ],
  serviceKinds: ["llm"],
};