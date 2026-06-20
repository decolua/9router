// OmniRoute huggingchat provider — ported to fork conventions.
// Source authType: "apikey" + authHeader: "cookie" + custom executor "huggingchat".
// Distinct alias: "hc" belongs to hackclub; huggingchat is addressed by its own id.
export default {
  id: "huggingchat",
  priority: 100,
  alias: "huggingchat",
  display: {
    name: "HuggingChat (Web)",
    icon: "forum",
    color: "#FFD21E",
    textIcon: "HC",
    website: "https://huggingface.co/chat",
  },
  category: "apikey",
  authHint: "Paste your hf-chat session cookie from huggingface.co/chat (DevTools > Application > Cookies)",
  transport: {
    baseUrl: "https://huggingface.co/chat/conversation",
    auth: { combined: true, header: "Cookie", scheme: "raw" },
  },
  passthroughModels: true,
  models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B" },
    { id: "mistralai/Mistral-Small-24B-Instruct-2501", name: "Mistral Small 24B" },
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
  ],
};
