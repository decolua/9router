export default {
  id: "featherless",
  priority: 65,
  alias: "featherless",
  aliases: [
    "fl",
  ],
  uiAlias: "fl",
  display: {
    name: "Featherless",
    icon: "flutter_dash",
    color: "#111827",
    textIcon: "FL",
    website: "https://featherless.ai",
    notice: {
      apiKeyUrl: "https://featherless.ai/account/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.featherless.ai/v1/chat/completions",
    validateUrl: "https://api.featherless.ai/v1/models",
  },
  models: [
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-ai/DeepSeek-V4-Flash", name: "DeepSeek V4 Flash" },
    { id: "zai-org/GLM-5.2", name: "GLM 5.2" },
    { id: "zai-org/GLM-5.1", name: "GLM 5.1" },
    { id: "moonshotai/Kimi-K2.7-Code", name: "Kimi K2.7 Code" },
    { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6" },
    { id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5" },
  ],
};
