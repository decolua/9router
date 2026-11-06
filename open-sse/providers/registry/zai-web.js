export default {
  id: "zai-web",
  priority: 147,
  alias: "zai-web",
  aliases: ["zw", "zhipu-cookie"],
  uiAlias: "zw",
  display: {
    name: "Zhipu Z.ai Web",
    icon: "bolt",
    color: "#3B82F6",
    textIcon: "ZW",
    website: "https://chat.z.ai",
    notice: {
      apiKeyUrl: "https://chat.z.ai",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your token from chat.z.ai (DevTools -> Application -> Local Storage -> token)",
  transport: {
    baseUrl: "https://chat.z.ai/openai/chat/completions",
    format: "openai",
    authType: "cookie",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  models: [
    { id: "glm-5.3-flash", name: "GLM-5.3 Flash (web)" },
    { id: "glm-5.3", name: "GLM-5.3 (web)" },
    { id: "glm-5.2", name: "GLM-5.2 (web)" },
    { id: "glm-4-plus", name: "GLM-4 Plus (web)" },
  ],
  passthroughModels: true,
};
