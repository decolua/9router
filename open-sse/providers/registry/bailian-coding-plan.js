// OmniRoute claude-format provider (Alibaba Bailian coding-plan, Anthropic-compatible).
const bailianCodingPlan = {
  id: "bailian-coding-plan",
  priority: 70,
  alias: "bcp",
  display: {
    name: "Bailian Coding Plan",
    icon: "code",
    color: "#FF6A00",
    textIcon: "BC",
    website: "https://www.alibabacloud.com/help/en/bailian",
    notice: {
      apiKeyUrl: "https://bailian.console.aliyun.com",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic/v1/messages",
    format: "claude",
    headers: {
      "Anthropic-Version": "2023-06-01",
    },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
    },
    quirks: {},
  },
  models: [
    { id: "qwen3.6-plus", name: "Qwen3.6 Plus (vision)" },
    { id: "qwen3.5-plus", name: "Qwen3.5 Plus (vision)" },
    { id: "qwen3-max-2026-01-23", name: "Qwen3 Max" },
    { id: "kimi-k2.5", name: "Kimi K2.5 (vision)" },
    { id: "glm-5", name: "GLM 5" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
  ],
};
export default bailianCodingPlan;
