export default {
  id: "volcengine-ark",
  priority: 270,
  alias: "volcengine-ark",
  aliases: [
    "ark",
  ],
  uiAlias: "ark",
  display: {
    name: "Volcengine Ark",
    icon: "cloud",
    color: "#1677FF",
    textIcon: "ARK",
    website: "https://ark.cn-beijing.volces.com",
    notice: {
      apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions",
    headers: {},
  },
  models: [
    { id: "Doubao-Seed-2.0-Code", name: "Doubao-Seed-2.0-Code" },
    { id: "Doubao-Seed-2.0-pro", name: "Doubao-Seed-2.0-pro" },
    { id: "Doubao-Seed-2.0-lite", name: "Doubao-Seed-2.0-lite" },
    { id: "Doubao-Seed-Code", name: "Doubao-Seed-Code" },
    { id: "GLM-5.2", name: "GLM-5.2" },
    { id: "Kimi-K2.7-Code", name: "Kimi-K2.7-Code" },
    { id: "MiniMax-M3", name: "MiniMax-M3" },
    { id: "DeepSeek-V4-Flash", name: "DeepSeek-V4-Flash" },
    { id: "DeepSeek-V4-Pro", name: "DeepSeek-V4-Pro" },
    { id: "MiniMax-M2.7", name: "MiniMax-M2.7" },
    { id: "Kimi-K2.6", name: "Kimi-K2.6" },
  ],
};
