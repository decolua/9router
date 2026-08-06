import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "ovh",
  priority: 90,
  hasFree: true,
  alias: "ovh",
  uiAlias: "ovh",
  display: {
    name: "OVH AI Endpoints",
    icon: "cloud",
    color: "#0078D4",
    textIcon: "OV",
    website: "https://ai.endpoints.ovh.com",
    notice: {
      text: "Free tier available with generous limits",
      apiKeyUrl: "https://ai.endpoints.ovh.com/settings/api-keys",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://ai.endpoints.ovh.com/v1/chat/completions",
    validateUrl: "https://ai.endpoints.ovh.com/v1/models",
  },
  models: [
    { id: "ovh/mistral-7b-instruct", name: "Mistral 7B Instruct" },
    { id: "ovh/llama-3-8b-instruct", name: "Llama 3 8B Instruct" },
    { id: "ovh/llama-3-70b-instruct", name: "Llama 3 70B Instruct" },
    { id: "ovh/mixtral-8x7b-instruct", name: "Mixtral 8x7B Instruct" },
    { id: "ovh/codellama-7b-instruct", name: "CodeLlama 7B Instruct" },
    { id: "ovh/codellama-34b-instruct", name: "CodeLlama 34B Instruct" },
  ],
  features: {
    usage: true,
    usageApikey: true,
  },
};