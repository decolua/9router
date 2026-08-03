import { CLAUDE_API_HEADERS } from "../shared.js";

export default {
  id: "agentrouter",
  priority: 60,
  hasFree: true,
  alias: "agentrouter",
  display: {
    name: "AgentRouter",
    icon: "alt_route",
    color: "#6366F1",
    textIcon: "AR",
    website: "https://agentrouter.org",
    notice: {
      apiKeyUrl: "https://agentrouter.org/console/token",
    },
  },
  category: "apikey",
  // Primary transport: OpenAI-compatible endpoint for gpt-* / glm-* models.
  transport: {
    baseUrl: "https://agentrouter.org/v1/chat/completions",
    validateUrl: "https://agentrouter.org/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  // claude-* models route to the Anthropic-compatible endpoint; gpt-*/glm-* use OpenAI-compatible.
  transports: [
    {
      format: "openai",
      baseUrl: "https://agentrouter.org/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://agentrouter.org/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
  ],
  models: [
    { id: "gpt-5.6", name: "GPT-5.6" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", targetFormat: "claude" },
    { id: "claude-opus-4-7", name: "Claude Opus 4.7", targetFormat: "claude" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8", targetFormat: "claude" },
  ],
};
