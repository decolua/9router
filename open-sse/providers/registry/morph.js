export default {
  id: "morph",
  alias: "morph",
  aliases: ["morphllm"],
  uiAlias: "morph",
  display: {
    name: "Morph",
    icon: "change_history",
    color: "#14B8A6",
    textIcon: "MP",
    website: "https://morphllm.com",
    notice: { apiKeyUrl: "https://morphllm.com" },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.morphllm.com/v1/chat/completions",
    validateUrl: "https://api.morphllm.com/v1/models",
  },
  models: [
    { id: "morph-v3-large", name: "Morph v3 Large" },
    { id: "morph-v3-fast", name: "Morph v3 Fast" },
    { id: "morph-qwen35-397b", name: "Qwen 3.5 397B (Morph)", contextLength: 262144 },
    { id: "morph-minimax27-230b", name: "MiniMax M2.7 (Morph)", contextLength: 200704 },
    { id: "morph-qwen36-27b", name: "Qwen 3.6 27B (Morph)", contextLength: 131072 },
    { id: "morph-dsv4flash", name: "DeepSeek V4 Flash (Morph)", contextLength: 1048576 },
  ],
};
