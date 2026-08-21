// Alibaba Token Plan — China mainland only.
// Fourth Alibaba key type: Coding Plan (alicode/alicode-intl) and Model Studio
// (alims-intl) both reject these keys, and they reject Model Studio keys back.
// This deployment intentionally targets the mainland Bailian endpoint. The
// Anthropic surface is not authorized for this plan, so OpenAI-compatible mode
// is the only transport.
export default {
  id: "alitp-intl",
  priority: 11,
  alias: "alitp-intl",
  display: {
    name: "Alibaba Token Plan (China)",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "ATP",
    website: "https://www.alibabacloud.com/campaign/ai-landing-page-token",
    notice: {
      apiKeyUrl: "https://bailian.console.aliyun.com/",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    headers: {},
    quirks: { preserveCacheControl: true },
  },
  models: [
    { id: "qwen3.8-max-preview", name: "Qwen3.8 Max Preview" },
    { id: "qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
    { id: "qwen3.6-flash", name: "Qwen3.6 Flash" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  ],
};
