import { CLAUDE_API_HEADERS } from "../shared.js";

// Token Plan — credit subscription keys on token-plan.<region>.maas.aliyuncs.com.
// Fourth Alibaba key type: Coding Plan (alicode/alicode-intl) and Model Studio
// (alims-intl) both reject these keys, and they reject Model Studio keys back.
// Singapore is the only region that serves the plan; eu-central-1 answers
// IllegalEndpoint.
export default {
  id: "alitp-intl",
  priority: 11,
  alias: "alitp-intl",
  display: {
    name: "Alibaba Token Plan",
    icon: "cloud",
    color: "#FF6A00",
    textIcon: "ATP",
    website: "https://www.alibabacloud.com/campaign/ai-landing-page-token",
    notice: {
      apiKeyUrl: "https://modelstudio.console.alibabacloud.com/?apiKey=1",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    headers: {},
    quirks: { preserveCacheControl: true },
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "claude",
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "Authorization", scheme: "bearer", anthropicVersion: true },
      thinkingFormat: "claude-adaptive",
    },
    {
      format: "openai",
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    { id: "auto", name: "Auto" },
    { id: "qwen4-max", name: "Qwen4 Max" },
    { id: "qwen4-max-preview", name: "Qwen4 Max Preview" },
    { id: "qwen3.8-max", name: "Qwen3.8 Max" },
    { id: "qwen3.8-max-preview", name: "Qwen3.8 Max Preview" },
    { id: "qwen3.8-flash", name: "Qwen3.8 Flash" },
    { id: "qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
    { id: "qwen3.6-flash", name: "Qwen3.6 Flash" },
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-pro-0813", name: "DeepSeek V4 Pro 0813" },
    { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash 0731" },
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 Flash 1017" },
  ],
};
