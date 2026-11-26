export default {
  id: "runcrate",
  priority: 65,
  alias: "runcrate",
  aliases: [
    "rc",
  ],
  uiAlias: "rc",
  display: {
    name: "Runcrate",
    icon: "terminal",
    color: "#1A2B79",
    textIcon: "RC",
    website: "https://www.runcrate.ai/inference/free?utm_source=9router&utm_medium=directory&utm_campaign=gpu_pricing",
    notice: {
      apiKeyUrl: "https://www.runcrate.ai/dashboard/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.runcrate.ai/v1/chat/completions",
    // /v1/models is public, so it cannot tell a bad key from a good one; the billing API can.
    validateUrl: "https://www.runcrate.ai/api/v1/billing/balance",
  },
  models: [
    { id: "deepseek-ai/DeepSeek-V4.1-Flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-ai/DeepSeek-V4.1-Flash-1017", name: "DeepSeek V4.1 Flash 1017" },
    { id: "zai-org/GLM-5.3", name: "GLM 5.3" },
    { id: "zai-org/GLM-5.3-Flash", name: "GLM 5.3 Flash" },
    { id: "Qwen/Qwen3.8-Flash", name: "Qwen3.8 Flash" },
    { id: "openai/gpt-oss-120b", name: "gpt-oss 120B" },
  ],
};
