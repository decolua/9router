export default {
  id: "sambanova",
  priority: 70,
  hasFree: true,
  alias: "sambanova",
  display: {
    name: "SambaNova Cloud",
    icon: "cloud",
    color: "#6B3FA0",
    textIcon: "SN",
    website: "https://cloud.sambanova.ai",
    notice: {
      signupUrl: "https://cloud.sambanova.ai",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.sambanova.ai/v1/chat/completions",
    validateUrl: "https://api.sambanova.ai/v1/models",
  },
  models: [
    { id: "deepseek-v3.1", name: "DeepSeek V3.1" },
    { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
    { id: "gemma-4-31b-it", name: "Gemma 4 31B" },
    { id: "gpt-oss-120b", name: "GPT OSS 120B" },
    { id: "meta-llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "minimax-m2.7", name: "MiniMax M2.7" },
  ],
};
