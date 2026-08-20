export default {
  id: "gapgpt",
  priority: 96,
  alias: "gg",
  uiAlias: "gg",
  display: {
    name: "GapGPT",
    icon: "code",
    color: "#00B8A9",
    website: "https://gapgpt.app",
    notice: {
      signupUrl: "https://gapgpt.app/gapcode",
    },
  },
  category: "oauth",
  // OAuth only: GapGPT/GapCode never exposes a raw API key in its panel — the CLI
  // "OAuth" flow is the sole way to obtain the credential (it returns an api_key,
  // which we store as the bearer token). So no manual API-key entry in the UI.
  authModes: ["oauth"],
  hasOAuth: true,
  thinkingConfig: {
    options: [
      "auto",
      "none",
      "low",
      "medium",
      "high",
    ],
    defaultMode: "auto",
  },
  // GapCode is a fork of the OpenAI Codex CLI: it speaks the Responses API
  // (instructions/input/reasoning, store=false, forced streaming) against
  // api.gapgpt.app/v1/responses and serves the Codex model family. Handled by
  // the shared CodexExecutor (registered under "gapgpt" in executors/index.js).
  transport: {
    baseUrl: "https://api.gapgpt.app/v1/responses",
    format: "openai-responses",
    forceStream: true,
    headers: {
      originator: "codex_cli_rs",
    },
    usage: {
      url: "https://gapgpt.app/api/v1/api/codex/usage",
    },
  },
  models: [
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "kimi-3", name: "Kimi 3" },
    { id: "glm-5.3", name: "GLM-5.3" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "grok-4.6", name: "Grok 4.6" },
    { id: "claude-fable-5", name: "Claude Fable 5" },
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "gapgpt-qwen-3.6", name: "Qwen 3.6" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark" },
    { id: "gpt-5.5", name: "GPT-5.5" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "kimi-2.7", name: "Kimi 2.7" },
  ],
  serviceKinds: ["llm"],
  features: {
    usage: true,
  },
  oauth: {
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    authorizeUrl: "https://gapgpt.app/oauth/cli",
    tokenUrl: "https://gapgpt.app/api/v1/oauth/cli/token",
    scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
    codeChallengeMethod: "S256",
    fixedPort: 1455,
    callbackPath: "/auth/callback",
    extraParams: {
      id_token_add_organizations: "true",
      codex_cli_simplified_flow: "true",
      originator: "codex_cli_rs",
    },
    refresh: {
      encoding: "form",
    },
  },
};
