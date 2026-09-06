export default {
  id: "nous-portal",
  priority: 40,
  alias: "nous",
  uiAlias: "nous",
  display: {
    name: "Nous Portal",
    icon: "auto_awesome",
    color: "#FF6B1E",
    textIcon: "NP",
    website: "https://portal.nousresearch.com",
    notice: {
      signupUrl: "https://portal.nousresearch.com",
      text: "Login with Nous Research (Hermes CLI device flow). Requires an inference-enabled Nous account.",
    },
  },
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,
  authModes: ["oauth"],
  transport: {
    baseUrl: "https://inference-api.nousresearch.com/v1/chat/completions",
    // Hermes CLI traffic passes an OpenAI python-client fingerprint upstream
    headers: {
      "User-Agent": "OpenAI/Python 2.24.0",
      "X-Stainless-Arch": "x64",
      "X-Stainless-Async": "false",
      "X-Stainless-Lang": "python",
      "X-Stainless-Os": "Linux",
      "X-Stainless-Package-Version": "2.24.0",
      "X-Stainless-Read-Timeout": "30.0",
      "X-Stainless-Retry-Count": "0",
      "X-Stainless-Runtime": "CPython",
      "X-Stainless-Runtime-Version": "3.11.15",
    },
  },
  // OAuth device flow against portal.nousresearch.com (Hermes CLI client).
  // NOTE: no `refresh` block — the refresh token is carried in the
  // X-Nous-Refresh-Token header (not the body), so refresh goes through the
  // dedicated refreshNousPortalToken handler, not the generic REFRESH_GRANTS path.
  oauth: {
    clientId: "hermes-cli",
    deviceCodeUrl: "https://portal.nousresearch.com/api/oauth/device/code",
    tokenUrl: "https://portal.nousresearch.com/api/oauth/token",
    refreshUrl: "https://portal.nousresearch.com/api/oauth/token",
    scope: "inference:invoke",
    userInfoUrl: "https://portal.nousresearch.com/api/oauth/account",
  },
  // Portal catalog mirrors OpenRouter (~390 live ids incl. :batch/:US variants
  // and embeddings). Curation rule: vendor-published ~latest aliases (never go
  // stale) + pinned ids with no alias coverage; everything else is reachable
  // via modelsFetcher (type: nous, :free filter) or passthroughModels.
  models: [
    { id: "~anthropic/claude-opus-latest", name: "Claude Opus (latest)" },
    { id: "~anthropic/claude-sonnet-latest", name: "Claude Sonnet (latest)" },
    { id: "~openai/gpt-latest", name: "GPT (latest)" },
    { id: "~google/gemini-pro-latest", name: "Gemini Pro (latest)" },
    { id: "~google/gemini-flash-latest", name: "Gemini Flash (latest)" },
    { id: "~z-ai/glm-latest", name: "GLM (latest)" },
    { id: "~moonshotai/kimi-latest", name: "Kimi (latest)" },
    { id: "~deepseek/deepseek-v4-flash-latest", name: "DeepSeek V4 Flash (latest)" },
    { id: "~x-ai/grok-latest", name: "Grok (latest)" },
    { id: "openai/gpt-6-astra", name: "GPT-6 Astra" },
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "openai/gpt-5.6-terra", name: "GPT-5.6 Terra" },
    { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "z-ai/glm-5.3-flash", name: "GLM-5.3 Flash" },
    { id: "qwen/qwen3.8-max-0902", name: "Qwen3.8 Max" },
    { id: "qwen/qwen3.8-flash", name: "Qwen3.8 Flash" },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "tencent/hy4-preview", name: "Hunyuan 4 Preview" },
    { id: "minimax/minimax-m3", name: "MiniMax M3" },
    { id: "meta/muse-spark-1.3", name: "Muse Spark 1.3" },
    { id: "thinkingmachines/inkling", name: "Inkling" },
  ],
  modelsFetcher: { url: "https://inference-api.nousresearch.com/v1/models", type: "nous" },
  passthroughModels: true,
};
