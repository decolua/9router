/**
 * CodeBuddy — Tencent AI coding assistant (international + China).
 *
 * API: POST /v2/chat/completions (OpenAI-compatible SSE).
 * Auth: Bearer ck_<id>.<secret> (API key from dashboard).
 * Constraints: system message required; stream:true required.
 * Models: gpt-5.5, gpt-5.4, claude-sonnet-4.6, gemini-3.1-pro, etc.
 */
export default {
  id: "codebuddy",
  priority: 90,
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey", "oauth"],

  display: {
    name: "CodeBuddy",
    icon: "smart_toy",
    color: "#006EFF",
    textIcon: "CB",
    website: "https://www.codebuddy.ai",
    notice: {
      apiKeyUrl: "https://www.codebuddy.ai/console/api-keys",
      signupUrl: "https://www.codebuddy.ai",
    },
  },

  transport: {
    baseUrl: "https://www.codebuddy.ai/v2/chat/completions",
    format: "openai",
    forceStream: true,
    executor: "codebuddy",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
    headers: {
      "User-Agent": "CLI/2.106.3 CodeBuddy/2.106.3",
      "x-codebuddy-request": "1",
    },
  },

  oauth: {
    baseUrl: "https://www.codebuddy.ai",
    stateUrl: "https://www.codebuddy.ai/v2/plugin/auth/state",
    tokenUrl: "https://www.codebuddy.ai/v2/plugin/auth/token",
    refreshUrl: "https://www.codebuddy.ai/v2/plugin/auth/token/refresh",
    userAgent: "CLI/2.106.3 CodeBuddy/2.106.3",
    platform: "CLI",
    pollInterval: 5000,
  },

  models: [
    { id: "gpt-5.5", name: "GPT-5.5", contextWindow: 128000 },
    { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 128000 },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", contextWindow: 200000 },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", contextWindow: 1000000 },
  ],
};
