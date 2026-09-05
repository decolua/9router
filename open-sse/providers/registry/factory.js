export default {
  id: "factory",
  priority: 15,
  alias: "factory",
  aliases: ["fy", "droid", "factory-ai"],
  uiAlias: "fy",
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,
  authModes: ["oauth"],

  display: {
    name: "Factory (Droid)",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "FY",
    website: "https://factory.ai",
    notice: {
      signupUrl: "https://auth.factory.ai/device",
    },
  },

  transport: {
    baseUrl: "https://api.factory.ai/api/llm/o/v1/chat/completions",
    format: "openai",
    forceStream: true,
    headers: {
      "X-Factory-Client": "cli",
      "X-Client-Version": "0.213.0",
      "User-Agent": "factory-cli/0.213.0",
    },
    usage: {
      url: "https://api.factory.ai/api/billing/limits",
    },
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },

  transports: [
    {
      format: "claude",
      baseUrl: "https://api.factory.ai/api/llm/a/v1/messages",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "openai-responses",
      baseUrl: "https://api.factory.ai/api/llm/o/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "openai",
      baseUrl: "https://api.factory.ai/api/llm/o/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
  ],

  oauth: {
    platform: "factory",
    clientId: "client_01HNM792M5G5G1A2THWPXKFMXB",
    deviceCodeUrl: "https://api.workos.com/user_management/authorize/device",
    verificationUrl: "https://auth.factory.ai/device",
    tokenUrl: "https://api.workos.com/user_management/authenticate",
    refreshUrl: "https://api.workos.com/user_management/authenticate",
  },

  features: {
    usage: true,
  },

  models: [
    // Claude & Anthropic family (routed to /api/llm/a/v1/messages)
    { id: "claude-fable-5.1", name: "Claude Fable 5.1 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-fable-5", name: "Claude Fable 5 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-opus-5", name: "Claude Opus 5 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-opus-5-fast", name: "Claude Opus 5 Fast (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-opus-4-8-fast", name: "Claude Opus 4.8 Fast (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-opus-4-7", name: "Claude Opus 4.7 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-opus-4-7-fast", name: "Claude Opus 4.7 Fast (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-opus-4-6-fast", name: "Claude Opus 4.6 Fast (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "atlas-07-21", name: "Atlas 07-21 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "aster-07-15", name: "Aster 07-15 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },

    // MiniMax models (routed to /api/llm/a/v1/messages via Fireworks upstream)
    { id: "minimax-m3", name: "MiniMax M3 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "minimax-m2.7", name: "MiniMax M2.7 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },
    { id: "minimax-m2.5", name: "MiniMax M2.5 (Factory)", targetFormat: "claude", supportedFormats: ["claude"] },

    // GPT / Codex / Grok family (routed to /api/llm/o/v1/responses)
    { id: "gpt-6-astra", name: "GPT-6 Astra (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.6-sol-fast", name: "GPT-5.6 Sol Fast (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.6-terra", name: "GPT-5.6 Terra (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.5", name: "GPT-5.5 (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.5-pro", name: "GPT-5.5 Pro (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.5-fast", name: "GPT-5.5 Fast (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.4", name: "GPT-5.4 (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.4-fast", name: "GPT-5.4 Fast (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.4-mini-fast", name: "GPT-5.4 Mini Fast (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.2", name: "GPT-5.2 (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.1", name: "GPT-5.1 (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5", name: "GPT-5 (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.3-codex-fast", name: "GPT-5.3 Codex Fast (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.2-codex", name: "GPT-5.2 Codex (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.1-codex", name: "GPT-5.1 Codex (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "gpt-5-codex", name: "GPT-5 Codex (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "grok-4.6", name: "Grok 4.6 (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "grok-4.5", name: "Grok 4.5 (Factory)", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },

    // Core Open models (routed to /api/llm/o/v1/chat/completions)
    { id: "kimi-k3", name: "Kimi K3 (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "kimi-k2.7-code", name: "Kimi K2.7 Code (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "kimi-k2.6", name: "Kimi K2.6 (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "kimi-k2.5", name: "Kimi K2.5 (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "glm-5.3", name: "GLM 5.3 (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "glm-5.2", name: "GLM 5.2 (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "glm-5.2-fast", name: "GLM 5.2 Fast (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "glm-5.1", name: "GLM 5.1 (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "glm-5", name: "GLM 5 (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "glm-4.7", name: "GLM 4.7 (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "glm-4.6", name: "GLM 4.6 (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "deepseek-v4-flash-0731", name: "DeepSeek V4 Flash (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "nemotron-3-ultra", name: "Nemotron 3 Ultra (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "inkling", name: "Inkling (Factory)", targetFormat: "openai", supportedFormats: ["openai"] },
  ],
};
