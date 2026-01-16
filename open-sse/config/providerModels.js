// Provider models - Single source of truth
// Key = alias (cc, cx, gc, qw, if, ag, gh for OAuth; id for API Key)
// Field "provider" for special cases (e.g. AntiGravity models that call different backends)

export const PROVIDER_MODELS = {
  // OAuth Providers (using alias)
  cc: [  // Claude Code
    { id: "claude-opus-4-5-20251101", name: "Claude 4.5 Opus" },
    { id: "claude-sonnet-4-5-20250929", name: "Claude 4.5 Sonnet" },
    { id: "claude-haiku-4-5-20251001", name: "Claude 4.5 Haiku" },
  ],
  cx: [  // OpenAI Codex
    { id: "gpt-5.2-codex", name: "GPT 5.2 Codex" },
    { id: "gpt-5.2", name: "GPT 5.2" },
    { id: "gpt-5.1-codex-max", name: "GPT 5.1 Codex Max" },
    { id: "gpt-5.1-codex", name: "GPT 5.1 Codex" },
    { id: "gpt-5.1-codex-mini", name: "GPT 5.1 Codex Mini" },
    { id: "gpt-5.1", name: "GPT 5.1" },
    { id: "gpt-5-codex", name: "GPT 5 Codex" },
    { id: "gpt-5-codex-mini", name: "GPT 5 Codex Mini" },
  ],
  gc: [  // Gemini CLI
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
  ],
  qw: [  // Qwen Code
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    { id: "qwen3-coder-flash", name: "Qwen3 Coder Flash" },
    { id: "vision-model", name: "Qwen3 Vision Model" },
  ],
  if: [  // iFlow AI
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    { id: "kimi-k2", name: "Kimi K2" },
    { id: "kimi-k2-thinking", name: "Kimi K2 Thinking" },
    { id: "deepseek-r1", name: "DeepSeek R1" },
    { id: "deepseek-v3.2-chat", name: "DeepSeek V3.2 Chat" },
    { id: "deepseek-v3.2-reasoner", name: "DeepSeek V3.2 Reasoner" },
    { id: "minimax-m2", name: "MiniMax M2" },
    { id: "glm-4.6", name: "GLM 4.6" },
    { id: "glm-4.7", name: "GLM 4.7" },
  ],
  ag: [  // Antigravity - special case: models call different backends
    { id: "gemini-3-pro-low", name: "Gemini 3 Pro Low" },
    { id: "gemini-3-pro-high", name: "Gemini 3 Pro High" },
    { id: "gemini-3-flash", name: "Gemini 3 Flash" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 " },
    { id: "claude-sonnet-4-5-thinking", name: "Claude Sonnet 4.5 Thinking" },
    { id: "claude-opus-4-5-thinking", name: "Claude Opus 4.5" },
  ],
  gh: [  // GitHub Copilot
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
    // { id: "gpt-5.1", name: "GPT-5.1" },
    // { id: "gpt-5.2", name: "GPT-5.2" },
    // { id: "gpt-5-codex", name: "GPT-5 Codex" },
    { id: "gpt-5.1-codex", name: "GPT-5.1 Codex" },
    // { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini" },
    { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max" },
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "claude-4.5-sonnet", name: "Claude 4.5 Sonnet" },
    { id: "claude-4.5-opus", name: "Claude 4.5 Opus" },
    { id: "claude-4.5-haiku", name: "Claude 4.5 Haiku" },
    { id: "gemini-3-pro", name: "Gemini 3 Pro" },
    { id: "gemini-3-flash", name: "Gemini 3 Flash" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "grok-code-fast-1", name: "Grok Code Fast 1" },
  ],
  kr: [  // Kiro AI
    { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
  ],

  // API Key Providers (alias = id)
  openai: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
    { id: "o1", name: "O1" },
    { id: "o1-mini", name: "O1 Mini" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
  ],
  gemini: [
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
  ],
  openrouter: [
    { id: "auto", name: "Auto (Best Available)" },
  ],
  glm: [
    { id: "glm-4.7", name: "GLM 4.7" },
    { id: "glm-4.6", name: "GLM 4.6" },
    { id: "glm-4.6v", name: "GLM 4.6V (Vision)" },
  ],
  kimi: [
    { id: "kimi-latest", name: "Kimi Latest" },
  ],
  minimax: [
    { id: "MiniMax-M2.1", name: "MiniMax M2.1" },
  ],
};

// Helper functions
export function getProviderModels(aliasOrId) {
  return PROVIDER_MODELS[aliasOrId] || [];
}

export function getDefaultModel(aliasOrId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return models?.[0]?.id || null;
}

export function isValidModel(aliasOrId, modelId, passthroughProviders = new Set()) {
  if (passthroughProviders.has(aliasOrId)) return true;
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return false;
  return models.some(m => m.id === modelId);
}

export function findModelName(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return modelId;
  const found = models.find(m => m.id === modelId);
  return found?.name || modelId;
}

export function getModelTargetFormat(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = models.find(m => m.id === modelId);
  return found?.targetFormat || null;
}

// Provider ID to alias mapping
export const PROVIDER_ID_TO_ALIAS = {
  claude: "cc",
  codex: "cx",
  "gemini-cli": "gc",
  qwen: "qw",
  iflow: "if",
  antigravity: "ag",
  github: "gh",
  kiro: "kr",
  openai: "openai",
  anthropic: "anthropic",
  gemini: "gemini",
  openrouter: "openrouter",
  glm: "glm",
  kimi: "kimi",
  minimax: "minimax",
};

export function getModelsByProviderId(providerId) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return PROVIDER_MODELS[alias] || [];
}

