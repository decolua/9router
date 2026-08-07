export default {
  id: "openmodel",
  priority: 100,
  alias: "openmodel",
  uiAlias: "openmodel",
  display: {
    name: "OpenModel.ai",
    icon: "smart_toy",
    color: "#7C3AED",
    textIcon: "OM",
    website: "https://openmodel.ai",
    notice: {
      apiKeyUrl: "https://openmodel.ai/settings/api-keys",
      text: "OpenModel.ai uses the OpenAI Responses API format (/v1/responses). Compatible with Codex, Claude Code Responses mode.",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.openmodel.ai/v1/chat/completions",
    format: "openai",
  },
  models: [],
  features: {
    usage: true,
  },
};
