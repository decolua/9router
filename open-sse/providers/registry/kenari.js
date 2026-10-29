export default {
  id: "kenari",
  alias: "kenari",
  category: "apikey",
  display: {
    name: "kenari",
    icon: "bolt",
    color: "#0EA5E9",
    textIcon: "KN",
    website: "https://kenari.id",
    notice: {
      apiKeyUrl: "https://kenari.id/login",
    },
  },
  transport: {
    baseUrl: "https://kenari.id/v1/chat/completions",
    validateUrl: "https://kenari.id/v1/models",
    // Quota retrieval is implemented by open-sse/services/usage/kenari.js.
    usage: {
      url: "https://kenari.id/v1/account/quota",
    },
  },
  models: [
    { id: "step-3-7-flash", name: "Step 3.7 Flash" },
    { id: "glm-5-3-flash", name: "GLM 5.3 Flash" },
    { id: "gemini-2-5-flash-lite", name: "Gemini 2.5 Flash Lite" },
    { id: "gpt-oss-120b", name: "GPT-OSS 120B" },
  ],
  features: { usage: true, usageApikey: true },
  passthroughModels: true,
};
