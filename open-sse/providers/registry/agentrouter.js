// OmniRoute claude-format provider (format: "claude", default executor, apikey).
// Anthropic-compatible router — uses Claude CLI headers + x-api-key auth.
export default {
  id: "agentrouter",
  priority: 70,
  alias: "agentrouter",
  display: {
    name: "AgentRouter",
    icon: "hub",
    color: "#7C3AED",
    textIcon: "AR",
    website: "https://agentrouter.org",
    notice: {
      apiKeyUrl: "https://agentrouter.org",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://agentrouter.org/v1/messages",
    format: "claude",
    headers: {
      "Anthropic-Version": "2023-06-01",
      "Anthropic-Beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28",
      "Anthropic-Dangerous-Direct-Browser-Access": "true",
      "User-Agent": "claude-cli/2.1.92 (external, sdk-cli)",
      "X-App": "cli",
      "X-Stainless-Helper-Method": "stream",
      "X-Stainless-Runtime": "node",
      "X-Stainless-Lang": "js",
    },
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
    },
    quirks: {},
  },
  passthroughModels: true,
  models: [
    { id: "claude-opus-4-6", name: "Claude 4.6 Opus" },
    { id: "claude-haiku-4-5-20251001", name: "Claude 4.5 Haiku" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
  ],
};
