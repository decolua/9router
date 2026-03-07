// Model input token limits - defaults for each provider/model
// Users can override these in settings

// Default limits by provider (used when model-specific not defined)
export const PROVIDER_DEFAULT_LIMITS = {
  // Claude models (Anthropic)
  cc: 200000,       // Claude Code - 200K context
  anthropic: 200000,
  
  // OpenAI Codex
  cx: 200000,       // Codex - 200K context
  openai: 128000,   // GPT-4o - 128K
  gh: 200000,       // GitHub Copilot - 200K
  
  // Google
  gc: 200000,       // Gemini CLI - 200K
  gemini: 200000,   // Gemini API - 200K
  
  // Chinese providers
  qw: 32000,        // Qwen - 32K
  if: 128000,        // iFlow - varies by model
  ag: 200000,       // Antigravity - 200K (uses Gemini backend)
  kr: 200000,       // Kiro - 200K (uses Claude)
  
  // Other providers
  cu: 200000,       // Cursor
  kmc: 1000000,     // Kimi Coding - 1M!
  kc: 200000,       // KiloCode
  cl: 200000,       // Cline
  
  // API Key providers
  glm: 1000000,     // GLM - 1M!
  "glm-cn": 1000000,
  kimi: 1000000,    // Kimi - 1M!
  minimax: 1000000, // MiniMax - 1M!
  "minimax-cn": 1000000,
  deepseek: 64000,  // DeepSeek - 64K
  alicode: 128000,
  
  // Other API providers
  groq: 8192,
  xai: 131072,
  mistral: 128000,
  perplexity: 128000,
  together: 128000,
  fireworks: 128000,
  cerebras: 128000,
  cohere: 128000,
  nvidia: 128000,
  nebius: 128000,
  siliconflow: 128000,
  hyperbolic: 128000,
};

// Model-specific overrides (more specific limits for particular models)
export const MODEL_SPECIFIC_LIMITS = {
  // Claude specific
  "cc:claude-haiku-4-5-20251001": 200000,
  "cc:claude-sonnet-4-5-20250929": 200000,
  "cc:claude-opus-4-5-20251101": 200000,
  "cc:claude-opus-4-6": 200000,
  "cc:claude-sonnet-4-6": 200000,
  
  // OpenAI specific  
  "openai:o1": 200000,
  "openai:o1-mini": 128000,
  "openai:gpt-4-turbo": 128000,
  "openai:gpt-4o": 128000,
  "openai:gpt-4o-mini": 128000,
  
  // Gemini specific
  "gemini:gemini-2.5-flash-lite": 100000,
  
  // Qwen specific (some have larger context)
  "qw:qwen3-coder-plus": 32000,
  "qw:qwen3-coder-flash": 32000,
  
  // iFlow specific
  "if:kimi-k2": 128000,
  "if:kimi-k2-thinking": 128000,
  "if:kimi-k2.5": 128000,
  "if:deepseek-r1": 64000,
  "if:deepseek-v3.2-chat": 64000,
  "if:minimax-m2.1": 1000000,
  "if:minimax-m2.5": 1000000,
  "if:glm-4.7": 1000000,
  "if:glm-4.6": 1000000,
  "if:glm-5": 1000000,
  "if:qwen3-coder-plus": 32000,
  
  // GLM specific
  "glm:glm-5": 1000000,
  "glm:glm-4.7": 1000000,
  "glm:glm-4.6": 1000000,
  
  // MiniMax specific
  "minimax:MiniMax-M2.5": 1000000,
  "minimax:MiniMax-M2.1": 1000000,
  
  // Kimi specific
  "kimi:kimi-k2.5": 1000000,
  "kimi:kimi-k2.5-thinking": 1000000,
  "kimi:kimi-latest": 1000000,
  
  // DeepSeek specific
  "deepseek:deepseek-chat": 64000,
  "deepseek:deepseek-reasoner": 64000,
  
  // Kiro specific
  "kr:claude-sonnet-4.5": 200000,
  "kr:claude-haiku-4.5": 200000,
  
  // Cursor specific
  "cu:claude-4.5-opus-high-thinking": 200000,
  "cu:claude-4.5-opus-high": 200000,
  "cu:claude-4.5-sonnet-thinking": 200000,
  "cu:claude-4.5-sonnet": 200000,
  "cu:claude-4.5-haiku": 200000,
  "cu:claude-4.5-opus": 200000,
  "cu:claude-4.6-opus-max": 200000,
  "cu:claude-4.6-sonnet-medium-thinking": 200000,
  "cu:kimi-k2.5": 1000000,
  "cu:gemini-3-flash-preview": 200000,
  "cu:gpt-5.2-codex": 200000,
  "cu:gpt-5.2": 200000,
  "cu:gpt-5.3-codex": 200000,
  
  // Kimi Coding specific
  "kmc:kimi-k2.5": 1000000,
  "kmc:kimi-k2.5-thinking": 1000000,
  "kmc:kimi-latest": 1000000,
  
  // KiloCode specific
  "kc:anthropic/claude-sonnet-4-20250514": 200000,
  "kc:anthropic/claude-opus-4-20250514": 200000,
  "kc:google/gemini-2.5-pro": 200000,
  "kc:google/gemini-2.5-flash": 100000,
  "kc:openai/gpt-4.1": 128000,
  "kc:openai/o3": 200000,
  "kc:deepseek/deepseek-chat": 64000,
  "kc:deepseek/deepseek-reasoner": 64000,
  
  // Cline specific
  "cl:anthropic/claude-sonnet-4-20250514": 200000,
  "cl:anthropic/claude-opus-4-20250514": 200000,
  "cl:google/gemini-2.5-pro": 200000,
  "cl:google/gemini-2.5-flash": 100000,
  "cl:openai/gpt-4.1": 128000,
  "cl:openai/o3": 200000,
  "cl:deepseek/deepseek-chat": 64000,
  
  // GitHub Copilot specific
  "gh:gpt-3.5-turbo": 16385,
  "gh:gpt-4": 8192,
  "gh:gpt-4o": 128000,
  "gh:gpt-4o-mini": 128000,
  "gh:gpt-4.1": 128000,
  "gh:gpt-5": 200000,
  "gh:gpt-5-mini": 200000,
  "gh:gpt-5-codex": 200000,
  "gh:gpt-5.1": 200000,
  "gh:gpt-5.1-codex": 200000,
  "gh:gpt-5.1-codex-mini": 200000,
  "gh:gpt-5.1-codex-max": 200000,
  "gh:gpt-5.2": 200000,
  "gh:gpt-5.2-codex": 200000,
  "gh:gpt-5.3-codex": 200000,
  "gh:claude-haiku-4.5": 200000,
  "gh:claude-opus-4.1": 200000,
  "gh:claude-opus-4.5": 200000,
  "gh:claude-sonnet-4": 200000,
  "gh:claude-sonnet-4.5": 200000,
  "gh:claude-sonnet-4.6": 200000,
  "gh:claude-opus-4.6": 200000,
  "gh:gemini-2.5-pro": 200000,
  "gh:gemini-3-flash-preview": 200000,
  "gh:gemini-3-pro-preview": 200000,
  "gh:grok-code-fast-1": 131072,
  "gh:oswe-vscode-prime": 131072,
  
  // Codex specific
  "cx:gpt-5.3-codex": 200000,
  "cx:gpt-5.3-codex-xhigh": 200000,
  "cx:gpt-5.3-codex-high": 200000,
  "cx:gpt-5.3-codex-low": 200000,
  "cx:gpt-5.3-codex-none": 200000,
  "cx:gpt-5.3-codex-spark": 200000,
  "cx:gpt-5.1-codex-mini": 200000,
  "cx:gpt-5.1-codex-mini-high": 200000,
  "cx:gpt-5.2-codex": 200000,
  "cx:gpt-5.2": 200000,
  "cx:gpt-5.1-codex-max": 200000,
  "cx:gpt-5.1-codex": 200000,
  "cx:gpt-5.1": 200000,
  "cx:gpt-5-codex": 200000,
  "cx:gpt-5-codex-mini": 200000,
  
  // Gemini CLI specific
  "gc:gemini-3-flash-preview": 200000,
  "gc:gemini-3-pro-preview": 200000,
  
  // Antigravity specific
  "ag:gemini-3.1-pro-high": 200000,
  "ag:gemini-3.1-pro-low": 200000,
  "ag:gemini-3-flash": 200000,
  "ag:claude-sonnet-4-6": 200000,
  "ag:claude-opus-4-6-thinking": 200000,
  "ag:gpt-oss-120b-medium": 128000,
};

/**
 * Get max input tokens for a model
 * @param {string} provider - Provider alias (e.g., "cc", "openai", "if")
 * @param {string} model - Model ID
 * @param {object} customLimits - Optional custom limits from user settings
 * @returns {number} Max input tokens
 */
export function getMaxInputTokens(provider, model, customLimits = null) {
  // Check custom limits first (user overrides)
  if (customLimits) {
    const key = `${provider}:${model}`;
    if (customLimits[key] !== undefined) {
      return customLimits[key];
    }
    if (customLimits[provider] !== undefined) {
      return customLimits[provider];
    }
  }
  
  // Check model-specific limit
  const modelKey = `${provider}:${model}`;
  if (MODEL_SPECIFIC_LIMITS[modelKey] !== undefined) {
    return MODEL_SPECIFIC_LIMITS[modelKey];
  }
  
  // Fall back to provider default
  return PROVIDER_DEFAULT_LIMITS[provider] || 100000; // Default 100K if unknown
}
