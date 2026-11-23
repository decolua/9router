import { CLAUDE_API_HEADERS } from "../shared.js";

// QwenCloud Token Plan — subscription keys (sk-sp-) on token-plan.maas.qwencloudapi.com.
// Pay-as-you-go QwenCloud keys (sk-) use the regional <region>.maas.qwencloudapi.com hosts
// and are rejected here (401 invalid_api_key).
export default {
  id: "qwencloud",
  priority: 118,
  alias: "qwencloud",
  aliases: [
    "qc",
    "qctp",
    "qwen-cloud",
  ],
  uiAlias: "qc",
  display: {
    name: "QwenCloud",
    icon: "cloud",
    color: "#8B3DFE",
    textIcon: "QC",
    website: "https://www.qwencloud.com",
    notice: {
      text: "QwenCloud Token Plan subscription. Plan keys start with sk-sp- and only work on the token-plan endpoint; pay-as-you-go keys (sk-) belong to the regional QwenCloud endpoints.",
      apiKeyUrl: "https://home.qwencloud.com/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: [
    "apikey",
  ],
  transport: {
    baseUrl: "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1/chat/completions",
    validateUrl: "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1/models",
    quirks: { preserveCacheControl: true },
  },
  // Multi-endpoint: match the client's sourceFormat so no lossy translation runs.
  // All three lanes were probed with a plan key (chat, Anthropic messages, Responses).
  transports: [
    {
      format: "openai",
      baseUrl: "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://token-plan.maas.qwencloudapi.com/apps/anthropic/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true },
      thinkingFormat: "claude-adaptive",
    },
    {
      format: "openai-responses",
      baseUrl: "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    { id: "auto", name: "Auto" },
    { id: "qwen4-max", name: "Qwen4 Max" },
    { id: "qwen4-max-preview", name: "Qwen4 Max Preview" },
    { id: "qwen3.8-max", name: "Qwen3.8 Max" },
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
