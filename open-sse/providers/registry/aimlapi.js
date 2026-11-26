export default {
  id: "aimlapi",
  alias: "aimlapi",
  aliases: [
    "aiml",
  ],
  uiAlias: "aiml",
  display: {
    name: "AI/ML API",
    icon: "hub",
    color: "#0F172A",
    textIcon: "AI",
    website: "https://aimlapi.com",
    notice: {
      text: "OpenAI-compatible gateway to 300+ chat models (OpenAI, Anthropic, Google, DeepSeek, Qwen, ...). The same key also powers web search and page fetch through the AI/ML API Toolbox. Pay-as-you-go.",
      apiKeyUrl: "https://aimlapi.com/app/keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: [
    "apikey",
  ],
  transport: {
    baseUrl: "https://api.aimlapi.com/v1/chat/completions",
    thinkingFormat: "openai",
    // /v1/models is public, so it cannot tell a bad key from a good one; /v1/key can.
    validateUrl: "https://api.aimlapi.com/v1/key",
  },
  serviceKinds: ["llm", "webSearch", "webFetch"],
  // Toolbox runs both through one endpoint; the tool name selects the backend.
  // maxRedirects 0: the Bearer key must never follow a redirect to another host.
  searchConfig: {
    baseUrl: "https://tools.aimlapi.com/v1/tools/run",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    tool: "context_dev__web_search",
    maxCostUsd: 0.05,
    searchTypes: [
      "web",
    ],
    defaultMaxResults: 5,
    maxMaxResults: 20,
    maxRedirects: 0,
    timeoutMs: 30000,
    cacheTTLMs: 300000,
  },
  fetchConfig: {
    baseUrl: "https://tools.aimlapi.com/v1/tools/run",
    method: "POST",
    authType: "apikey",
    authHeader: "bearer",
    tool: "context_dev__web_scrape_markdown",
    maxCostUsd: 0.05,
    formats: [
      "markdown",
    ],
    maxCharacters: 100000,
    timeoutMs: 60000,
  },
  // Chat-completions models with tools + streaming + vision from GET /v1/models?include=all.
  models: [
    { id: "openai/gpt-6.2-sol", name: "GPT-6.2 Sol" },
    { id: "openai/gpt-6-luna", name: "GPT-6 Luna" },
    { id: "anthropic/claude-sonnet-5.5", name: "Claude Sonnet 5.5" },
    { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5" },
    { id: "anthropic/claude-haiku-5.5", name: "Claude Haiku 5.5" },
    { id: "google/gemini-4-hydrogen", name: "Gemini 4 Hydrogen" },
    { id: "google/gemini-3.8-flash", name: "Gemini 3.8 Flash" },
    { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
    { id: "z-ai/glm-5.3-flashx", name: "GLM 5.3 FlashX" },
    { id: "alibaba/qwen4-max", name: "Qwen4 Max" },
    { id: "moonshot/kimi-k3-1-pro", name: "Kimi K3.1 Pro" },
    { id: "x-ai/grok-4-7", name: "Grok 4.7" },
    { id: "minimax/minimax-m3.1-flash", name: "MiniMax M3.1 Flash" },
    { id: "xiaomi/mimo-v2.6-pro", name: "MiMo V2.6 Pro" },
  ],
  passthroughModels: true,
};
