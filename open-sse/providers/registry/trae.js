import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "trae",
  priority: 120,
  alias: "trae",
  uiAlias: "trae",
  display: {
    name: "TRAE AI",
    icon: "code",
    color: "#00D4AA",
    textIcon: "TR",
    website: "https://trae.ai",
    notice: {
      apiKeyUrl: "https://platform.trae.ai/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.trae.ai/v1/chat/completions",
    validateUrl: "https://api.trae.ai/v1/models",
  },
  models: [
    { id: "trae-v1", name: "TRAE V1" },
    { id: "trae-v1-thinking", name: "TRAE V1 Thinking" },
  ],
  features: {
    usage: true,
    usageApikey: true,
  },
};