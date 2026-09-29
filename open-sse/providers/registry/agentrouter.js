import { CLAUDE_CLI_SPOOF_HEADERS } from "../shared.js";

export default {
  id: "agentrouter",
  alias: "ar",
  uiAlias: "ar",
  display: {
    name: "AgentRouter",
    icon: "hub",
    color: "#6366F1",
    textIcon: "AR",
    website: "https://agentrouter.org",
    notice: {
      apiKeyUrl: "https://agentrouter.org",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://agentrouter.org/v1/chat/completions",
    format: "openai",
    headers: {
      "User-Agent": CLAUDE_CLI_SPOOF_HEADERS["User-Agent"],
    },
  },
  models: [
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "glm-5.3", name: "GLM 5.3" },
  ],
  passthroughModels: true,
};
