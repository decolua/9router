// AgentRouter only accepts Anthropic-format requests (/v1/messages) with Claude CLI
// spoof headers. OpenAI-format (/v1/chat/completions) returns 401 "unauthorized client".
// All models (gpt-5.5, gpt-5.6, glm-5.2, claude-*) route through /v1/messages.
import { CLAUDE_CLI_SPOOF_HEADERS, ANTHROPIC_API_VERSION } from "../shared.js";

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
  // Single transport: Anthropic-compatible only.
  // AgentRouter gates on Claude CLI fingerprint headers (X-Stainless-*, User-Agent, Anthropic-Beta).
  transport: {
    format: "claude",
    baseUrl: "https://agentrouter.org/v1/messages",
    validateUrl: "https://agentrouter.org/v1/messages",
    auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["agentrouterWaf"] },
    headers: { ...CLAUDE_CLI_SPOOF_HEADERS },
  },
  models: [
    { id: "gpt-5.6", name: "GPT-5.6", targetFormat: "claude" },
    { id: "gpt-5.5", name: "GPT-5.5", targetFormat: "claude" },
    { id: "glm-5.2", name: "GLM 5.2", targetFormat: "claude" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", targetFormat: "claude" },
    { id: "claude-opus-4-7", name: "Claude Opus 4.7", targetFormat: "claude" },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8", targetFormat: "claude" },
  ],
};
