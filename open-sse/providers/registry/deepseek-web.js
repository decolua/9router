export default {
  id: "deepseek-web",
  priority: 140,
  alias: "deepseek-web",
  aliases: [
    "dsw",
    "deepseek-cookie",
  ],
  uiAlias: "dsw",
  display: {
    name: "DeepSeek Web (Cookie)",
    icon: "bolt",
    color: "#4D6BFE",
    textIcon: "DSW",
    website: "https://chat.deepseek.com",
    notice: {
      apiKeyUrl: "https://chat.deepseek.com",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your userToken / session token from chat.deepseek.com (DevTools -> Application -> Local Storage/Cookies)",
  transport: {
    baseUrl: "https://chat.deepseek.com/api/v0",
    format: "deepseek-web",
    authType: "cookie",
  },
  models: [
    { id: "deepseek-chat", name: "DeepSeek V3/V4 Chat" },
    { id: "deepseek-reasoner", name: "DeepSeek R1/V4 Reasoner (Thinking)" },
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-v4.1-pro", name: "DeepSeek V4.1 Pro" },
    { id: "deepseek-v4.1-reasoner", name: "DeepSeek V4.1 Reasoner" },
    { id: "deepseek-v3", name: "DeepSeek V3" },
    { id: "deepseek-r1", name: "DeepSeek R1" },
  ],
  passthroughModels: true,
};
