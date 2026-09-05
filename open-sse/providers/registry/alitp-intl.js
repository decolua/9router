// Token Plan — a fourth Alibaba key type: Coding Plan (alicode/alicode-intl) and
// Model Studio (alims-intl) hosts reject it, and it rejects theirs. Only the
// Singapore region serves these keys (eu-central-1: 401 invalid API key).
// Chat completions is the only surface with video/PDF parts; /responses is the
// only one that executes the web_search Harness tool (enable_search is a silent
// no-op on chat). Image/TTS are DashScope-native on the same host.
// `models` is the offline fallback; live catalog: services/alibabaTokenPlanModels.js.
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
  serviceKinds: ["llm", "image", "tts"],
  transport: {
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    validateUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/models",
    headers: {},
    quirks: { preserveCacheControl: true },
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip
  // translation. No supportedFormats guards — every chat model answers on all three.
  transports: [
    {
      format: "openai-responses",
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic/v1/messages",
      auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true },
      thinkingFormat: "claude-budget", // native thinking, not compatible-mode reasoning_effort
    },
  ],
  models: [
    { id: "qwen3.8-max", name: "Qwen3.8 Max" },
    { id: "qwen3.8-flash", name: "Qwen3.8 Flash" },
    { id: "qwen3.7-max", name: "Qwen3.7 Max" },
    { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
    { id: "qwen3.6-flash", name: "Qwen3.6 Flash" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-pro-0813", name: "DeepSeek V4 Pro 0813" },
    { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash 0731" },
    { id: "wan2.7-image", name: "Wan2.7 Image", kind: "image", params: ["size"] },
    { id: "wan2.7-image-pro", name: "Wan2.7 Image Pro", kind: "image", params: ["size"] },
    { id: "qwen-audio-3.0-tts-plus", name: "Qwen Audio 3.0 TTS Plus", kind: "tts" },
  ],
  imageConfig: {
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
  },
  ttsConfig: {
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
    authType: "apikey",
    authHeader: "bearer",
    format: "dashscope-tts",
  },
};
