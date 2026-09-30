export default {
  id: "api-airforce",
  alias: "af",
  aliases: [
    "airforce",
  ],
  uiAlias: "af",
  display: {
    name: "API.airforce",
    icon: "flight",
    color: "#0EA5E9",
    textIcon: "AF",
    website: "https://api.airforce",
    notice: {
      apiKeyUrl: "https://api.airforce",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: [
    "apikey",
  ],
  passthroughModels: true,
  modelsFetcher: { url: "https://api.airforce/v1/models", type: "airforce-free" },
  transport: {
    baseUrl: "https://api.airforce/v1/chat/completions",
    validateUrl: "https://api.airforce/v1/models",
    headers: {
      "HTTP-Referer": "https://endpoint-proxy.local",
      "X-Title": "Endpoint Proxy",
    },
    forceStream: true,
  },
  models: [
    { id: "gpt-oss-120b", name: "GPT-OSS 120B (Free)", contextLength: 131072 },
    { id: "gpt-oss-20b", name: "GPT-OSS 20B (Free)", contextLength: 131072 },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code (Free)", contextLength: 262144 },
  ],
};
