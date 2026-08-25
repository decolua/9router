import { CLAUDE_CLI_SPOOF_HEADERS } from "../shared.js";

const CODEX_CLI_HEADERS = {
  originator: "codex_cli_rs",
  "User-Agent": "codex_cli_rs/0.136.0",
};

export default {
  id: "agentrouter",
  priority: 15,
  alias: "agentrouter",
  display: {
    name: "AgentRouter",
    icon: "router",
    color: "#10B981",
    textIcon: "AR",
    website: "https://agentrouter.org",
    notice: {
      text: "$200 free credits on signup - multi-model routing gateway.",
      apiKeyUrl: "https://agentrouter.org/register",
    },
  },
  category: "freeTier",
  hasFree: true,
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://agentrouter.org/v1/messages",
    format: "claude",
    urlSuffix: "?beta=true",
    headers: { ...CLAUDE_CLI_SPOOF_HEADERS },
    auth: { combined: true, header: "x-api-key", scheme: "raw" },
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://agentrouter.org/v1/chat/completions",
      headers: { ...CODEX_CLI_HEADERS },
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://agentrouter.org/v1/messages",
      urlSuffix: "?beta=true",
      headers: { ...CLAUDE_CLI_SPOOF_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw" },
    },
    {
      format: "openai-responses",
      baseUrl: "https://agentrouter.org/v1/responses",
      headers: { ...CODEX_CLI_HEADERS },
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],
  models: [
    { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "gpt-5.6-sol", name: "GPT 5.6 Sol" },
  ],
  serviceKinds: ["llm"],
  passthroughModels: true,
};
