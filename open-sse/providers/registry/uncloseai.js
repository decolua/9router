// OmniRoute uncloseai provider — free OpenAI-compatible endpoint (auth optional).
// Ported as default-executor noAuth (authType "optional" = works without a key).
const uncloseai = {
  id: "uncloseai",
  priority: 70,
  alias: "unc",
  display: {
    name: "UncloseAI",
    icon: "hub",
    color: "#10B981",
    textIcon: "UN",
    website: "https://hermes.ai.unturf.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://hermes.ai.unturf.com/v1/chat/completions",
    validateUrl: "https://hermes.ai.unturf.com/v1/models",
    noAuth: true,
  },
  models: [
    { id: "adamo1139/Hermes-3-Llama-3.1-8B-FP8-Dynamic", name: "Hermes 3 Llama 3.1 8B (Free)" },
    { id: "qwen3.6:27b", name: "Qwen3 Coder 27B (Free)" },
    { id: "gemma4:31b", name: "Gemma 4 31B (Free)" },
  ],
};
export default uncloseai;
