// OmniRoute hackclub provider — free OpenAI-compatible proxy (auth optional).
// Ported as default-executor noAuth (authType "optional" = works without a key).
const hackclub = {
  id: "hackclub",
  priority: 70,
  alias: "hc",
  display: {
    name: "Hack Club AI",
    icon: "rocket_launch",
    color: "#F23E96",
    textIcon: "HC",
    website: "https://ai.hackclub.com",
  },
  category: "apikey",
  transport: {
    baseUrl: "https://ai.hackclub.com/proxy/v1/chat/completions",
    validateUrl: "https://ai.hackclub.com/proxy/v1/models",
    noAuth: true,
  },
  passthroughModels: true,
  models: [
    { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "mistralai/mistral-7b-instruct", name: "Mistral 7B" },
    { id: "deepseek-ai/deepseek-coder-33b", name: "DeepSeek Coder 33B" },
  ],
};
export default hackclub;
