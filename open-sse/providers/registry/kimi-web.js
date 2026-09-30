export default {
  id: "kimi-web",
  priority: 142,
  alias: "kimi-web",
  aliases: [
    "kweb",
    "kimi-cookie",
  ],
  uiAlias: "kweb",
  display: {
    name: "Kimi Web",
    icon: "bolt",
    color: "#1AB69D",
    textIcon: "KW",
    website: "https://www.kimi.ai",
    notice: {
      apiKeyUrl: "https://www.kimi.ai",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your access_token from www.kimi.ai (DevTools -> Application -> Local Storage)",
  transport: {
    baseUrl: "https://www.kimi.ai",
    format: "kimi-web",
    authType: "cookie",
  },
  models: [
    { id: "k3", name: "Kimi K3" },
    { id: "k2d6", name: "Kimi K2.6" },
  ],
  passthroughModels: true,
};
