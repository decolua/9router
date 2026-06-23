// Z.ai ZCode — OpenAI-compatible free-tier endpoint (distinct from the Anthropic-format GLM provider).
// Base URL: https://zcode.z.ai — no custom executor needed (DefaultExecutor handles OpenAI-compatible).
// Alias "zai" is intentionally different from "glm" and "glm-cn" to avoid routing collision.
const zai = {
  id: "zai",
  alias: "zai",
  display: {
    name: "Z.ai (ZCode Free)",
    icon: "bolt",
    color: "#10B981",
    textIcon: "ZC",
    website: "https://zcode.z.ai",
    notice: {
      apiKeyUrl: "https://www.z.ai/api-key",
      freeTier: "Free tier: GLM models via the ZCode OpenAI-compatible endpoint.",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://zcode.z.ai/api/v1/chat/completions",
    validateUrl: "https://zcode.z.ai/api/v1/models",
    format: "openai",
  },
  models: [
    { id: "glm-5-turbo", name: "GLM 5 Turbo (Free)" },
    { id: "glm-5.2",     name: "GLM 5.2 (Free)" },
    { id: "glm-4.5-air", name: "GLM 4.5 Air (Free)" },
  ],
};
export default zai;
