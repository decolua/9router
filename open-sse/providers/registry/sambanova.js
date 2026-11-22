export default {
  id: "sambanova",
  alias: "samba",
  aliases: ["sambanova-ai"],
  uiAlias: "samba",
  hidden: true,
  display: {
    name: "SambaNova",
    icon: "memory",
    color: "#F97316",
    textIcon: "SN",
    website: "https://sambanova.ai",
    notice: {
      apiKeyUrl: "https://cloud.sambanova.ai/apis",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.sambanova.ai/v1/chat/completions",
    validateUrl: "https://api.sambanova.ai/v1/models",
  },
  models: [
    { id: "GLM-5.3", name: "GLM 5.3" },
    { id: "Meta-Llama-3.3-70B-Instruct", name: "Meta Llama 3.3 70B Instruct" },
    { id: "MiniMax-M3.1-Flash", name: "MiniMax M3.1 Flash" },
    { id: "gemma-4-31B-it", name: "Gemma 4 31B IT" },
    { id: "gpt-oss-120b", name: "GPT-OSS 120B" },
  ],
};
