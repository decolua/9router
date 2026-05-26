// Pricing rates for AI models — all rates in $/1M tokens
//
// Fallback order (first match wins):
//   1. PROVIDER_PRICING[provider][model]  — provider-specific override
//   2. MODEL_PRICING[model]               — canonical model price (provider-agnostic)
//   3. PATTERN_PRICING                    — glob pattern match (e.g. "codex-*")

/**
 * Canonical model pricing — provider-agnostic.
 * Cover all known models; deduplicated across providers.
 */
export const MODEL_PRICING = {
  // === Anthropic / Claude ===
  "claude-opus-4-6": {
    input: 5.0,
    output: 25.0,
    cached: 0.5,
    reasoning: 25.0,
    cache_creation: 6.25,
  },
  "claude-opus-4-5-20251101": {
    input: 5.0,
    output: 25.0,
    cached: 0.5,
    reasoning: 25.0,
    cache_creation: 6.25,
  },
  "claude-sonnet-4-6": {
    input: 3.0,
    output: 15.0,
    cached: 0.3,
    reasoning: 15.0,
    cache_creation: 3.75,
  },
  "claude-sonnet-4-5-20250929": {
    input: 3.0,
    output: 15.0,
    cached: 0.3,
    reasoning: 15.0,
    cache_creation: 3.75,
  },
  "claude-haiku-4-5-20251001": {
    input: 1.0,
    output: 5.0,
    cached: 0.1,
    reasoning: 5.0,
    cache_creation: 1.25,
  },
  "claude-sonnet-4-20250514": {
    input: 3.0,
    output: 15.0,
    cached: 1.5,
    reasoning: 15.0,
    cache_creation: 3.0,
  },
  "claude-opus-4-20250514": {
    input: 15.0,
    output: 25.0,
    cached: 7.5,
    reasoning: 112.5,
    cache_creation: 15.0,
  },
  "claude-3-5-sonnet-20241022": {
    input: 3.0,
    output: 15.0,
    cached: 1.5,
    reasoning: 15.0,
    cache_creation: 3.0,
  },
  "claude-haiku-4.5": {
    input: 0.5,
    output: 2.5,
    cached: 0.05,
    reasoning: 3.75,
    cache_creation: 0.5,
  },
  "claude-opus-4.1": {
    input: 5.0,
    output: 25.0,
    cached: 0.5,
    reasoning: 37.5,
    cache_creation: 5.0,
  },
  "claude-opus-4.5": {
    input: 5.0,
    output: 25.0,
    cached: 0.5,
    reasoning: 37.5,
    cache_creation: 5.0,
  },
  "claude-opus-4.6": {
    input: 5.0,
    output: 25.0,
    cached: 0.5,
    reasoning: 37.5,
    cache_creation: 5.0,
  },
  "claude-sonnet-4": {
    input: 3.0,
    output: 15.0,
    cached: 0.3,
    reasoning: 22.5,
    cache_creation: 3.0,
  },
  "claude-sonnet-4.5": {
    input: 3.0,
    output: 15.0,
    cached: 0.3,
    reasoning: 22.5,
    cache_creation: 3.0,
  },
  "claude-sonnet-4.6": {
    input: 3.0,
    output: 15.0,
    cached: 0.3,
    reasoning: 22.5,
    cache_creation: 3.0,
  },
  "claude-opus-4-5-thinking": {
    input: 5.0,
    output: 25.0,
    cached: 0.5,
    reasoning: 37.5,
    cache_creation: 5.0,
  },
  "claude-opus-4-6-thinking": {
    input: 5.0,
    output: 25.0,
    cached: 0.5,
    reasoning: 37.5,
    cache_creation: 5.0,
  },

  // === OpenAI / GPT ===
  "gpt-3.5-turbo": {
    input: 0.5,
    output: 1.5,
    cached: 0.25,
    reasoning: 2.25,
    cache_creation: 0.5,
  },
  "gpt-4": {
    input: 2.5,
    output: 10.0,
    cached: 1.25,
    reasoning: 15.0,
    cache_creation: 2.5,
  },
  "gpt-4-turbo": {
    input: 10.0,
    output: 30.0,
    cached: 5.0,
    reasoning: 45.0,
    cache_creation: 10.0,
  },
  "gpt-4o": {
    input: 2.5,
    output: 10.0,
    cached: 1.25,
    reasoning: 15.0,
    cache_creation: 2.5,
  },
  "gpt-4o-mini": {
    input: 0.15,
    output: 0.6,
    cached: 0.075,
    reasoning: 0.9,
    cache_creation: 0.15,
  },
  "gpt-4.1": {
    input: 2.5,
    output: 10.0,
    cached: 1.25,
    reasoning: 15.0,
    cache_creation: 2.5,
  },
  "gpt-5": {
    input: 3.0,
    output: 12.0,
    cached: 1.5,
    reasoning: 18.0,
    cache_creation: 3.0,
  },
  "gpt-5-mini": {
    input: 0.75,
    output: 3.0,
    cached: 0.375,
    reasoning: 4.5,
    cache_creation: 0.75,
  },
  "gpt-5-codex": {
    input: 3.0,
    output: 12.0,
    cached: 1.5,
    reasoning: 18.0,
    cache_creation: 3.0,
  },
  "gpt-5.1": {
    input: 4.0,
    output: 16.0,
    cached: 2.0,
    reasoning: 24.0,
    cache_creation: 4.0,
  },
  "gpt-5.1-codex": {
    input: 4.0,
    output: 16.0,
    cached: 2.0,
    reasoning: 24.0,
    cache_creation: 4.0,
  },
  "gpt-5.1-codex-mini": {
    input: 1.5,
    output: 6.0,
    cached: 0.75,
    reasoning: 9.0,
    cache_creation: 1.5,
  },
  "gpt-5.1-codex-mini-high": {
    input: 2.0,
    output: 8.0,
    cached: 1.0,
    reasoning: 12.0,
    cache_creation: 2.0,
  },
  "gpt-5.1-codex-max": {
    input: 8.0,
    output: 32.0,
    cached: 4.0,
    reasoning: 48.0,
    cache_creation: 8.0,
  },
  "gpt-5.2": {
    input: 5.0,
    output: 20.0,
    cached: 2.5,
    reasoning: 30.0,
    cache_creation: 5.0,
  },
  "gpt-5.2-codex": {
    input: 5.0,
    output: 20.0,
    cached: 2.5,
    reasoning: 30.0,
    cache_creation: 5.0,
  },
  "gpt-5.3-codex": {
    input: 6.0,
    output: 24.0,
    cached: 3.0,
    reasoning: 36.0,
    cache_creation: 6.0,
  },
  "gpt-5.3-codex-xhigh": {
    input: 10.0,
    output: 40.0,
    cached: 5.0,
    reasoning: 60.0,
    cache_creation: 10.0,
  },
  "gpt-5.3-codex-high": {
    input: 8.0,
    output: 32.0,
    cached: 4.0,
    reasoning: 48.0,
    cache_creation: 8.0,
  },
  "gpt-5.3-codex-low": {
    input: 4.0,
    output: 16.0,
    cached: 2.0,
    reasoning: 24.0,
    cache_creation: 4.0,
  },
  "gpt-5.3-codex-none": {
    input: 3.0,
    output: 12.0,
    cached: 1.5,
    reasoning: 18.0,
    cache_creation: 3.0,
  },
  "gpt-5.3-codex-spark": {
    input: 3.0,
    output: 12.0,
    cached: 0.3,
    reasoning: 12.0,
    cache_creation: 3.0,
  },
  o1: {
    input: 15.0,
    output: 60.0,
    cached: 7.5,
    reasoning: 90.0,
    cache_creation: 15.0,
  },
  "o1-mini": {
    input: 3.0,
    output: 12.0,
    cached: 1.5,
    reasoning: 18.0,
    cache_creation: 3.0,
  },

  // === Gemini ===
  "gemini-3-flash-preview": {
    input: 0.5,
    output: 3.0,
    cached: 0.03,
    reasoning: 4.5,
    cache_creation: 0.5,
  },
  "gemini-3-pro-preview": {
    input: 2.0,
    output: 12.0,
    cached: 0.25,
    reasoning: 18.0,
    cache_creation: 2.0,
  },
  "gemini-3.1-pro-low": {
    input: 2.0,
    output: 12.0,
    cached: 0.25,
    reasoning: 18.0,
    cache_creation: 2.0,
  },
  "gemini-3.1-pro-high": {
    input: 4.0,
    output: 18.0,
    cached: 0.5,
    reasoning: 27.0,
    cache_creation: 4.0,
  },
  "gemini-pro-agent": {
    input: 4.0,
    output: 18.0,
    cached: 0.5,
    reasoning: 27.0,
    cache_creation: 4.0,
  },
  "gemini-3-flash-agent": {
    input: 0.5,
    output: 3.0,
    cached: 0.03,
    reasoning: 4.5,
    cache_creation: 0.5,
  },
  "gemini-3.5-flash-low": {
    input: 0.5,
    output: 3.0,
    cached: 0.03,
    reasoning: 4.5,
    cache_creation: 0.5,
  },
  "gemini-3-flash": {
    input: 0.5,
    output: 3.0,
    cached: 0.03,
    reasoning: 4.5,
    cache_creation: 0.5,
  },
  "gemini-2.5-pro": {
    input: 2.0,
    output: 12.0,
    cached: 0.25,
    reasoning: 18.0,
    cache_creation: 2.0,
  },
  "gemini-2.5-flash": {
    input: 0.3,
    output: 2.5,
    cached: 0.03,
    reasoning: 3.75,
    cache_creation: 0.3,
  },
  "gemini-2.5-flash-lite": {
    input: 0.15,
    output: 1.25,
    cached: 0.015,
    reasoning: 1.875,
    cache_creation: 0.15,
  },

  // === Qwen ===
  "qwen3-coder-plus": {
    input: 1.0,
    output: 4.0,
    cached: 0.5,
    reasoning: 6.0,
    cache_creation: 1.0,
  },
  "qwen3-coder-flash": {
    input: 0.5,
    output: 2.0,
    cached: 0.25,
    reasoning: 3.0,
    cache_creation: 0.5,
  },

  // === Kimi ===
  "kimi-k2": {
    input: 1.0,
    output: 4.0,
    cached: 0.5,
    reasoning: 6.0,
    cache_creation: 1.0,
  },
  "kimi-k2-thinking": {
    input: 1.5,
    output: 6.0,
    cached: 0.75,
    reasoning: 9.0,
    cache_creation: 1.5,
  },
  "kimi-k2.5": {
    input: 1.2,
    output: 4.8,
    cached: 0.6,
    reasoning: 7.2,
    cache_creation: 1.2,
  },
  "kimi-k2.5-thinking": {
    input: 1.8,
    output: 7.2,
    cached: 0.9,
    reasoning: 10.8,
    cache_creation: 1.8,
  },
  "kimi-latest": {
    input: 1.0,
    output: 4.0,
    cached: 0.5,
    reasoning: 6.0,
    cache_creation: 1.0,
  },

  // === DeepSeek ===
  "deepseek-chat": {
    input: 0.14,
    output: 0.28,
    cached: 0.0028,
    reasoning: 0.28,
    cache_creation: 0.14,
  },
  "deepseek-reasoner": {
    input: 0.14,
    output: 0.28,
    cached: 0.0028,
    reasoning: 0.28,
    cache_creation: 0.14,
  },
  "deepseek-r1": {
    input: 0.14,
    output: 0.28,
    cached: 0.0028,
    reasoning: 0.28,
    cache_creation: 0.14,
  },
  "deepseek-v3.2-chat": {
    input: 0.14,
    output: 0.28,
    cached: 0.0028,
    reasoning: 0.28,
    cache_creation: 0.14,
  },
  "deepseek-v3.2-reasoner": {
    input: 0.14,
    output: 0.28,
    cached: 0.0028,
    reasoning: 0.28,
    cache_creation: 0.14,
  },
  "deepseek-v4-flash": {
    input: 0.14,
    output: 0.28,
    cached: 0.0028,
    reasoning: 0.28,
    cache_creation: 0.14,
  },
  "deepseek-v4-pro": {
    input: 0.435,
    output: 0.87,
    cached: 0.003625,
    reasoning: 0.87,
    cache_creation: 0.435,
  },

  // === GLM ===
  "glm-4.6": {
    input: 0.5,
    output: 2.0,
    cached: 0.25,
    reasoning: 3.0,
    cache_creation: 0.5,
  },
  "glm-4.6v": {
    input: 0.75,
    output: 3.0,
    cached: 0.375,
    reasoning: 4.5,
    cache_creation: 0.75,
  },
  "glm-4.7": {
    input: 0.75,
    output: 3.0,
    cached: 0.375,
    reasoning: 4.5,
    cache_creation: 0.75,
  },
  "glm-5": {
    input: 1.0,
    output: 4.0,
    cached: 0.5,
    reasoning: 6.0,
    cache_creation: 1.0,
  },

  // === MiniMax ===
  "MiniMax-M2.1": {
    input: 0.5,
    output: 2.0,
    cached: 0.25,
    reasoning: 3.0,
    cache_creation: 0.5,
  },
  "MiniMax-M2.5": {
    input: 0.5,
    output: 2.0,
    cached: 0.25,
    reasoning: 3.0,
    cache_creation: 0.5,
  },
  "MiniMax-M2.7": {
    input: 0.5,
    output: 2.0,
    cached: 0.25,
    reasoning: 3.0,
    cache_creation: 0.5,
  },
  "minimax-m2.1": {
    input: 0.5,
    output: 2.0,
    cached: 0.25,
    reasoning: 3.0,
    cache_creation: 0.5,
  },
  "minimax-m2.5": {
    input: 0.6,
    output: 2.4,
    cached: 0.3,
    reasoning: 3.6,
    cache_creation: 0.6,
  },

  // === Grok ===
  "grok-code-fast-1": {
    input: 0.5,
    output: 2.0,
    cached: 0.25,
    reasoning: 3.0,
    cache_creation: 0.5,
  },

  // === OpenRouter fallback ===
  auto: {
    input: 2.0,
    output: 8.0,
    cached: 1.0,
    reasoning: 12.0,
    cache_creation: 2.0,
  },

  // === Misc ===
  "oswe-vscode-prime": {
    input: 1.0,
    output: 4.0,
    cached: 0.5,
    reasoning: 6.0,
    cache_creation: 1.0,
  },
  "gpt-oss-120b-medium": {
    input: 0.5,
    output: 2.0,
    cached: 0.25,
    reasoning: 3.0,
    cache_creation: 0.5,
  },
  "vision-model": {
    input: 1.5,
    output: 6.0,
    cached: 0.75,
    reasoning: 9.0,
    cache_creation: 1.5,
  },
  "coder-model": {
    input: 1.5,
    output: 6.0,
    cached: 0.75,
    reasoning: 9.0,
    cache_creation: 1.5,
  },
};

/**
 * Provider-specific pricing overrides.
 * Only include entries where price DIFFERS from MODEL_PRICING.
 * Keyed by provider alias (cc, cx, gc, gh, ...) or provider id (openai, anthropic, ...).
 */
export const PROVIDER_PRICING = {
  // GitHub Copilot (gh) — gpt-5.3-codex has different rate than canonical
  gh: {
    "gpt-5.3-codex": {
      input: 1.75,
      output: 14.0,
      cached: 0.175,
      reasoning: 14.0,
      cache_creation: 1.75,
    },
  },
};

/**
 * Pattern-based pricing fallback — matched when no exact model entry found.
 * Patterns use simple glob: "*" matches any substring.
 * First match wins — order matters.
 */
export const PATTERN_PRICING = [
  // --- Codex variants ---
  {
    pattern: "*-codex-xhigh",
    pricing: {
      input: 10.0,
      output: 40.0,
      cached: 5.0,
      reasoning: 60.0,
      cache_creation: 10.0,
    },
  },
  {
    pattern: "*-codex-high",
    pricing: {
      input: 8.0,
      output: 32.0,
      cached: 4.0,
      reasoning: 48.0,
      cache_creation: 8.0,
    },
  },
  {
    pattern: "*-codex-max",
    pricing: {
      input: 8.0,
      output: 32.0,
      cached: 4.0,
      reasoning: 48.0,
      cache_creation: 8.0,
    },
  },
  {
    pattern: "*-codex-mini-*",
    pricing: {
      input: 1.5,
      output: 6.0,
      cached: 0.75,
      reasoning: 9.0,
      cache_creation: 1.5,
    },
  },
  {
    pattern: "*-codex-mini",
    pricing: {
      input: 1.5,
      output: 6.0,
      cached: 0.75,
      reasoning: 9.0,
      cache_creation: 1.5,
    },
  },
  {
    pattern: "*-codex-low",
    pricing: {
      input: 4.0,
      output: 16.0,
      cached: 2.0,
      reasoning: 24.0,
      cache_creation: 4.0,
    },
  },
  {
    pattern: "*-codex-none",
    pricing: {
      input: 3.0,
      output: 12.0,
      cached: 1.5,
      reasoning: 18.0,
      cache_creation: 3.0,
    },
  },
  {
    pattern: "*-codex-spark",
    pricing: {
      input: 3.0,
      output: 12.0,
      cached: 0.3,
      reasoning: 12.0,
      cache_creation: 3.0,
    },
  },
  {
    pattern: "codex-*",
    pricing: {
      input: 3.0,
      output: 12.0,
      cached: 1.5,
      reasoning: 18.0,
      cache_creation: 3.0,
    },
  },
  {
    pattern: "*-codex",
    pricing: {
      input: 3.0,
      output: 12.0,
      cached: 1.5,
      reasoning: 18.0,
      cache_creation: 3.0,
    },
  },

  // --- Claude ---
  {
    pattern: "claude-opus-*",
    pricing: {
      input: 5.0,
      output: 25.0,
      cached: 0.5,
      reasoning: 25.0,
      cache_creation: 6.25,
    },
  },
  {
    pattern: "claude-sonnet-*",
    pricing: {
      input: 3.0,
      output: 15.0,
      cached: 0.3,
      reasoning: 15.0,
      cache_creation: 3.75,
    },
  },
  {
    pattern: "claude-haiku-*",
    pricing: {
      input: 1.0,
      output: 5.0,
      cached: 0.1,
      reasoning: 5.0,
      cache_creation: 1.25,
    },
  },
  {
    pattern: "claude-*",
    pricing: {
      input: 3.0,
      output: 15.0,
      cached: 0.3,
      reasoning: 15.0,
      cache_creation: 3.75,
    },
  },

  // --- Gemini (specific first, generic last) ---
  {
    pattern: "gemini-*-flash-lite",
    pricing: {
      input: 0.15,
      output: 1.25,
      cached: 0.015,
      reasoning: 1.875,
      cache_creation: 0.15,
    },
  },
  {
    pattern: "gemini-*-flash",
    pricing: {
      input: 0.3,
      output: 2.5,
      cached: 0.03,
      reasoning: 3.75,
      cache_creation: 0.3,
    },
  },
  {
    pattern: "gemini-*-pro",
    pricing: {
      input: 2.0,
      output: 12.0,
      cached: 0.25,
      reasoning: 18.0,
      cache_creation: 2.0,
    },
  },
  {
    pattern: "gemini-3-*",
    pricing: {
      input: 0.5,
      output: 3.0,
      cached: 0.03,
      reasoning: 4.5,
      cache_creation: 0.5,
    },
  },
  {
    pattern: "gemini-2.5-*",
    pricing: {
      input: 0.3,
      output: 2.5,
      cached: 0.03,
      reasoning: 3.75,
      cache_creation: 0.3,
    },
  },
  {
    pattern: "gemini-*",
    pricing: {
      input: 0.5,
      output: 3.0,
      cached: 0.03,
      reasoning: 4.5,
      cache_creation: 0.5,
    },
  },

  // --- GPT (specific first, generic last) ---
  {
    pattern: "gpt-5.3-*",
    pricing: {
      input: 6.0,
      output: 24.0,
      cached: 3.0,
      reasoning: 36.0,
      cache_creation: 6.0,
    },
  },
  {
    pattern: "gpt-5.2-*",
    pricing: {
      input: 5.0,
      output: 20.0,
      cached: 2.5,
      reasoning: 30.0,
      cache_creation: 5.0,
    },
  },
  {
    pattern: "gpt-5.1-*",
    pricing: {
      input: 4.0,
      output: 16.0,
      cached: 2.0,
      reasoning: 24.0,
      cache_creation: 4.0,
    },
  },
  {
    pattern: "gpt-5-*",
    pricing: {
      input: 3.0,
      output: 12.0,
      cached: 1.5,
      reasoning: 18.0,
      cache_creation: 3.0,
    },
  },
  {
    pattern: "gpt-5*",
    pricing: {
      input: 3.0,
      output: 12.0,
      cached: 1.5,
      reasoning: 18.0,
      cache_creation: 3.0,
    },
  },
  {
    pattern: "gpt-4o-*",
    pricing: {
      input: 0.15,
      output: 0.6,
      cached: 0.075,
      reasoning: 0.9,
      cache_creation: 0.15,
    },
  },
  {
    pattern: "gpt-4o",
    pricing: {
      input: 2.5,
      output: 10.0,
      cached: 1.25,
      reasoning: 15.0,
      cache_creation: 2.5,
    },
  },
  {
    pattern: "gpt-4*",
    pricing: {
      input: 2.5,
      output: 10.0,
      cached: 1.25,
      reasoning: 15.0,
      cache_creation: 2.5,
    },
  },

  // --- o1 / o-series ---
  {
    pattern: "o1-*",
    pricing: {
      input: 3.0,
      output: 12.0,
      cached: 1.5,
      reasoning: 18.0,
      cache_creation: 3.0,
    },
  },
  {
    pattern: "o1",
    pricing: {
      input: 15.0,
      output: 60.0,
      cached: 7.5,
      reasoning: 90.0,
      cache_creation: 15.0,
    },
  },
  {
    pattern: "o3-*",
    pricing: {
      input: 10.0,
      output: 40.0,
      cached: 5.0,
      reasoning: 60.0,
      cache_creation: 10.0,
    },
  },
  {
    pattern: "o4-*",
    pricing: {
      input: 2.0,
      output: 8.0,
      cached: 1.0,
      reasoning: 12.0,
      cache_creation: 2.0,
    },
  },

  // --- Qwen ---
  {
    pattern: "qwen3-coder-*",
    pricing: {
      input: 1.0,
      output: 4.0,
      cached: 0.5,
      reasoning: 6.0,
      cache_creation: 1.0,
    },
  },
  {
    pattern: "qwen*-coder-*",
    pricing: {
      input: 1.0,
      output: 4.0,
      cached: 0.5,
      reasoning: 6.0,
      cache_creation: 1.0,
    },
  },
  {
    pattern: "qwen*",
    pricing: {
      input: 0.5,
      output: 2.0,
      cached: 0.25,
      reasoning: 3.0,
      cache_creation: 0.5,
    },
  },

  // --- Kimi ---
  {
    pattern: "kimi-*-thinking",
    pricing: {
      input: 1.8,
      output: 7.2,
      cached: 0.9,
      reasoning: 10.8,
      cache_creation: 1.8,
    },
  },
  {
    pattern: "kimi-k2*",
    pricing: {
      input: 1.2,
      output: 4.8,
      cached: 0.6,
      reasoning: 7.2,
      cache_creation: 1.2,
    },
  },
  {
    pattern: "kimi-*",
    pricing: {
      input: 1.0,
      output: 4.0,
      cached: 0.5,
      reasoning: 6.0,
      cache_creation: 1.0,
    },
  },

  // --- DeepSeek ---
  {
    pattern: "deepseek-*reasoner*",
    pricing: {
      input: 0.14,
      output: 0.28,
      cached: 0.0028,
      reasoning: 0.28,
      cache_creation: 0.14,
    },
  },
  {
    pattern: "deepseek-r*",
    pricing: {
      input: 0.14,
      output: 0.28,
      cached: 0.0028,
      reasoning: 0.28,
      cache_creation: 0.14,
    },
  },
  {
    pattern: "deepseek-v*",
    pricing: {
      input: 0.14,
      output: 0.28,
      cached: 0.0028,
      reasoning: 0.28,
      cache_creation: 0.14,
    },
  },
  {
    pattern: "deepseek-*",
    pricing: {
      input: 0.14,
      output: 0.28,
      cached: 0.0028,
      reasoning: 0.28,
      cache_creation: 0.14,
    },
  },

  // --- GLM ---
  {
    pattern: "glm-5*",
    pricing: {
      input: 1.0,
      output: 4.0,
      cached: 0.5,
      reasoning: 6.0,
      cache_creation: 1.0,
    },
  },
  {
    pattern: "glm-4*",
    pricing: {
      input: 0.75,
      output: 3.0,
      cached: 0.375,
      reasoning: 4.5,
      cache_creation: 0.75,
    },
  },
  {
    pattern: "glm-*",
    pricing: {
      input: 0.5,
      output: 2.0,
      cached: 0.25,
      reasoning: 3.0,
      cache_creation: 0.5,
    },
  },

  // --- MiniMax ---
  {
    pattern: "MiniMax-*",
    pricing: {
      input: 0.5,
      output: 2.0,
      cached: 0.25,
      reasoning: 3.0,
      cache_creation: 0.5,
    },
  },
  {
    pattern: "minimax-*",
    pricing: {
      input: 0.5,
      output: 2.0,
      cached: 0.25,
      reasoning: 3.0,
      cache_creation: 0.5,
    },
  },

  // --- Grok ---
  {
    pattern: "grok-code-*",
    pricing: {
      input: 0.5,
      output: 2.0,
      cached: 0.25,
      reasoning: 3.0,
      cache_creation: 0.5,
    },
  },
  {
    pattern: "grok-*",
    pricing: {
      input: 0.5,
      output: 2.0,
      cached: 0.25,
      reasoning: 3.0,
      cache_creation: 0.5,
    },
  },
];

/**
 * Match a model ID against a glob pattern (* = wildcard).
 */
function matchPattern(pattern, model) {
  const regex = new RegExp(
    "^" +
      pattern
        .split("*")
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
  );
  return regex.test(model);
}

/**
 * Resolve pricing for a model using the 3-step fallback chain:
 *   1. PROVIDER_PRICING[provider][model]
 *   2. MODEL_PRICING[model]
 *   3. PATTERN_PRICING (glob match)
 *
 * @param {string} provider
 * @param {string} model
 * @returns {object|null}
 */
export function getPricingForModel(provider, model) {
  if (!model) return null;

  // 1. Provider-specific override
  if (provider && PROVIDER_PRICING[provider]?.[model]) {
    return PROVIDER_PRICING[provider][model];
  }

  // 2. Canonical model pricing (strip vendor prefix if needed: "deepseek/deepseek-chat" → "deepseek-chat")
  const baseModel = model.includes("/") ? model.split("/").pop() : model;
  if (MODEL_PRICING[baseModel]) return MODEL_PRICING[baseModel];
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];

  // 3. Pattern match
  for (const { pattern, pricing } of PATTERN_PRICING) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      return pricing;
    }
  }

  return null;
}

/**
 * Get all provider pricing (for UI / API).
 * Returns PROVIDER_PRICING — consumers should fall back to MODEL_PRICING for unlisted models.
 */
export function getDefaultPricing() {
  return PROVIDER_PRICING;
}

/**
 * Format cost for display
 * @param {number} cost
 * @returns {string}
 */
export function formatCost(cost) {
  if (cost === null || cost === undefined || isNaN(cost)) return "$0.00";
  return `$${cost.toFixed(2)}`;
}

/**
 * Calculate cost from tokens and pricing
 * @param {object} tokens
 * @param {object} pricing
 * @returns {number} cost in dollars
 */
export function calculateCostFromTokens(tokens, pricing) {
  if (!tokens || !pricing) return 0;

  let cost = 0;

  const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
  const cachedTokens =
    tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens);

  cost += nonCachedInput * (pricing.input / 1000000);

  if (cachedTokens > 0) {
    cost += cachedTokens * ((pricing.cached || pricing.input) / 1000000);
  }

  const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
  cost += outputTokens * (pricing.output / 1000000);

  const reasoningTokens = tokens.reasoning_tokens || 0;
  if (reasoningTokens > 0) {
    cost += reasoningTokens * ((pricing.reasoning || pricing.output) / 1000000);
  }

  const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
  if (cacheCreationTokens > 0) {
    cost +=
      cacheCreationTokens *
      ((pricing.cache_creation || pricing.input) / 1000000);
  }

  return cost;
}
