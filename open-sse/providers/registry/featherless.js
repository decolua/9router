export default {
  id: "featherless",
  priority: 22,
  hasFree: true,
  alias: "featherless",
  aliases: [
    "fl",
  ],
  uiAlias: "fl",
  display: {
    name: "Featherless.ai",
    icon: "api",
    color: "#8B5CF6",
    textIcon: "FL",
    website: "https://featherless.ai",
    notice: {
      text: "OpenAI-compatible API with 100,000 trial tokens on signup (no credit card required).",
      apiKeyUrl: "https://featherless.ai/account/api-keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.featherless.ai/v1/chat/completions",
    validateUrl: "https://api.featherless.ai/v1/models",
  },
  models: [
    { id: "moonshotai/Kimi-K2-Instruct", name: "Kimi K2 Instruct" },
    { id: "moonshotai/Kimi-K2-Instruct-0905", name: "Kimi K2 Instruct 0905" },
    { id: "Qwen/Qwen3-235B-A22B-Thinking-2507", name: "Qwen3 235B A22B Thinking" },
    { id: "Qwen/Qwen3-Coder-Next", name: "Qwen3 Coder Next" },
    { id: "deepseek-ai/DeepSeek-V3.1-Terminus", name: "DeepSeek V3.1 Terminus" },
    { id: "XiaomiMiMo/MiMo-V2.5", name: "MiMo V2.5" },
    { id: "nvidia/Llama-3_3-Nemotron-Super-49B-v1_5", name: "Llama 3.3 Nemotron Super 49B" },
  ],
  passthroughModels: true,
};
