import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "reasonix",
  priority: 121,
  alias: "reasonix",
  uiAlias: "reasonix",
  display: {
    name: "Reasonix IDE",
    icon: "psychology",
    color: "#8B5CF6",
    textIcon: "RX",
    website: "https://reasonix.ai",
    notice: {
      apiKeyUrl: "https://platform.reasonix.ai/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.reasonix.ai/v1/chat/completions",
    validateUrl: "https://api.reasonix.ai/v1/models",
  },
  models: [
    { id: "reasonix-v1", name: "Reasonix V1" },
    { id: "reasonix-v1-reasoning", name: "Reasonix V1 Reasoning" },
  ],
  features: {
    usage: true,
    usageApikey: true,
  },
};