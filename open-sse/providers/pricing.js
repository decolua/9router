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
  "claude-opus-4-6":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  "claude-opus-4-5-20251101":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  "claude-sonnet-4-6":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  },
  "claude-sonnet-4-5-20250929":   { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  },
  "claude-haiku-4-5-20251001":    { input: 1.00,  output: 5.00,  cached: 0.10,  reasoning: 5.00,   cache_creation: 1.25  },
  "claude-sonnet-4-20250514":     { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00,  cache_creation: 3.00  },
  "claude-opus-4-20250514":       { input: 15.00, output: 25.00, cached: 7.50,  reasoning: 112.50, cache_creation: 15.00 },
  "claude-3-5-sonnet-20241022":   { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00,  cache_creation: 3.00  },
  "claude-haiku-4.5":             { input: 0.50,  output: 2.50,  cached: 0.05,  reasoning: 3.75,   cache_creation: 0.50  },
  "claude-opus-4.1":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4.5":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4.6":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-sonnet-4":              { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-sonnet-4.5":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-sonnet-4.6":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-opus-4-5-thinking":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4-6-thinking":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },

  // === OpenAI / GPT ===
  // Standard API pricing from https://developers.openai.com/api/docs/pricing
  // (input/cached input/output in $ per 1M tokens).
  "gpt-3.5-turbo":                { input: 0.50,  output: 1.50,  cached: null,  reasoning: 1.50,   cache_creation: 0.50  },
  "gpt-4":                        { input: 30.00, output: 60.00, cached: null,  reasoning: 60.00,  cache_creation: 30.00 },
  "gpt-4-turbo":                  { input: 10.00, output: 30.00, cached: null,  reasoning: 30.00,  cache_creation: 10.00 },
  "gpt-4o":                       { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 10.00,  cache_creation: 2.50  },
  "gpt-4o-mini":                  { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.60,   cache_creation: 0.15  },
  "gpt-4.1":                      { input: 2.00,  output: 8.00,  cached: 0.50,  reasoning: 8.00,   cache_creation: 2.00  },
  "gpt-4.1-mini":                 { input: 0.40,  output: 1.60,  cached: 0.10,  reasoning: 1.60,   cache_creation: 0.40  },
  "gpt-4.1-nano":                 { input: 0.10,  output: 0.40,  cached: 0.025, reasoning: 0.40,   cache_creation: 0.10  },
  "gpt-5.5":                      { input: 5.00,  output: 30.00, cached: 0.50,  reasoning: 30.00,  cache_creation: 5.00  },
  "gpt-5.5-pro":                  { input: 30.00, output: 180.00, cached: null, reasoning: 180.00, cache_creation: 30.00 },
  "gpt-5.4":                      { input: 2.50,  output: 15.00, cached: 0.25,  reasoning: 15.00,  cache_creation: 2.50  },
  "gpt-5.4-mini":                 { input: 0.75,  output: 4.50,  cached: 0.075, reasoning: 4.50,   cache_creation: 0.75  },
  "gpt-5.4-nano":                 { input: 0.20,  output: 1.25,  cached: 0.02,  reasoning: 1.25,   cache_creation: 0.20  },
  "gpt-5.4-pro":                  { input: 30.00, output: 180.00, cached: null, reasoning: 180.00, cache_creation: 30.00 },
  "gpt-5":                        { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5-mini":                   { input: 0.25,  output: 2.00,  cached: 0.025, reasoning: 2.00,   cache_creation: 0.25  },
  "gpt-5-nano":                   { input: 0.05,  output: 0.40,  cached: 0.005, reasoning: 0.40,   cache_creation: 0.05  },
  "gpt-5-pro":                    { input: 15.00, output: 120.00, cached: null, reasoning: 120.00, cache_creation: 15.00 },
  "gpt-5-codex":                  { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5.1":                      { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5.1-codex":                { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5.1-codex-mini":           { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "gpt-5.1-codex-mini-high":      { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  },
  "gpt-5.1-codex-max":            { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  },
  "gpt-5.2":                      { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  "gpt-5.2-pro":                  { input: 21.00, output: 168.00, cached: null, reasoning: 168.00, cache_creation: 21.00 },
  "gpt-5.2-codex":                { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  "gpt-5.3-codex":                { input: 6.00,  output: 24.00, cached: 3.00,  reasoning: 36.00,  cache_creation: 6.00  },
  "gpt-5.3-codex-xhigh":         { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 },
  "gpt-5.3-codex-high":          { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  },
  "gpt-5.3-codex-low":           { input: 4.00,  output: 16.00, cached: 2.00,  reasoning: 24.00,  cache_creation: 4.00  },
  "gpt-5.3-codex-none":          { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  },
  "gpt-5.3-codex-spark":         { input: 3.00,  output: 12.00, cached: 0.30,  reasoning: 12.00,  cache_creation: 3.00  },
  "o1":                           { input: 15.00, output: 60.00, cached: 7.50,  reasoning: 60.00,  cache_creation: 15.00 },
  "o1-mini":                      { input: 1.10,  output: 4.40,  cached: 0.55,  reasoning: 4.40,   cache_creation: 1.10  },
  "o1-pro":                       { input: 150.00, output: 600.00, cached: null, reasoning: 600.00, cache_creation: 150.00 },
  "o3":                           { input: 2.00,  output: 8.00,  cached: 0.50,  reasoning: 8.00,   cache_creation: 2.00  },
  "o3-mini":                      { input: 1.10,  output: 4.40,  cached: 0.55,  reasoning: 4.40,   cache_creation: 1.10  },
  "o3-pro":                       { input: 20.00, output: 80.00, cached: null, reasoning: 80.00,  cache_creation: 20.00 },
  "o4-mini":                      { input: 1.10,  output: 4.40,  cached: 0.275, reasoning: 4.40,   cache_creation: 1.10  },

  // === Gemini ===
  "gemini-3-flash-preview":       { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3-pro-preview":         { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  "gemini-3.1-pro-low":           { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  "gemini-3.1-pro-high":          { input: 4.00,  output: 18.00, cached: 0.50,  reasoning: 27.00,  cache_creation: 4.00  },
  "gemini-pro-agent":             { input: 4.00,  output: 18.00, cached: 0.50,  reasoning: 27.00,  cache_creation: 4.00  },
  "gemini-3-flash-agent":         { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3.5-flash-low":         { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3.5-flash-extra-low":   { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-3-flash":               { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  },
  "gemini-2.5-pro":               { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  },
  "gemini-2.5-flash":             { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  },
  "gemini-2.5-flash-lite":        { input: 0.15,  output: 1.25,  cached: 0.015, reasoning: 1.875,  cache_creation: 0.15  },

  // === Qwen ===
  "qwen3-coder-plus":             { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "qwen3-coder-flash":            { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },

  // === Kimi ===
  "kimi-k2":                      { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "kimi-k2-thinking":             { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "kimi-k2.5":                    { input: 1.20,  output: 4.80,  cached: 0.60,  reasoning: 7.20,   cache_creation: 1.20  },
  "kimi-k2.5-thinking":           { input: 1.80,  output: 7.20,  cached: 0.90,  reasoning: 10.80,  cache_creation: 1.80  },
  "kimi-latest":                  { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },

  // === DeepSeek ===
  "deepseek-chat":                { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-reasoner":            { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-r1":                  { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v3.2-chat":           { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v3.2-reasoner":       { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v4-flash":            { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v4-pro":              { input: 0.435, output: 0.87,  cached: 0.003625, reasoning: 0.87,  cache_creation: 0.435 },

  // === GLM ===
  "glm-4.6":                      { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "glm-4.6v":                     { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  },
  "glm-4.7":                      { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  },
  "glm-5":                        { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },

  // === MiniMax ===
  "MiniMax-M3":                   { input: 0.30,  output: 1.20,  cached: 0.06,  reasoning: 1.80,   cache_creation: 0.30  },
  "MiniMax-M2.1":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "MiniMax-M2.5":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "MiniMax-M2.7":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "minimax-m2.1":                 { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "minimax-m2.5":                 { input: 0.60,  output: 2.40,  cached: 0.30,  reasoning: 3.60,   cache_creation: 0.60  },

  // === Grok ===
  "grok-code-fast-1":             { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },

  // === OpenRouter fallback ===
  "auto":                         { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  },

  // === Misc ===
  "oswe-vscode-prime":            { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "gpt-oss-120b-medium":          { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "vision-model":                 { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "coder-model":                  { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
};

/**
 * Provider-specific pricing overrides.
 * Only include entries where price DIFFERS from MODEL_PRICING.
 * Keyed by provider alias (cc, cx, gc, gh, ...) or provider id (openai, anthropic, ...).
 */
export const PROVIDER_PRICING = {
  // GitHub Copilot (gh) — gpt-5.3-codex has different rate than canonical
  gh: {
    "gpt-5.3-codex": { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 },
  },
};

/**
 * Pattern-based pricing fallback — matched when no exact model entry found.
 * Patterns use simple glob: "*" matches any substring.
 * First match wins — order matters.
 */
export const PATTERN_PRICING = [
  // --- Codex variants ---
  { pattern: "*-codex-xhigh",   pricing: { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 } },
  { pattern: "*-codex-high",    pricing: { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  } },
  { pattern: "*-codex-max",     pricing: { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  } },
  { pattern: "*-codex-mini-*",  pricing: { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  } },
  { pattern: "*-codex-mini",    pricing: { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  } },
  { pattern: "*-codex-low",     pricing: { input: 4.00,  output: 16.00, cached: 2.00,  reasoning: 24.00,  cache_creation: 4.00  } },
  { pattern: "*-codex-none",    pricing: { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  } },
  { pattern: "*-codex-spark",   pricing: { input: 3.00,  output: 12.00, cached: 0.30,  reasoning: 12.00,  cache_creation: 3.00  } },
  { pattern: "codex-*",         pricing: { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  } },
  { pattern: "*-codex",         pricing: { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  } },

  // --- Claude ---
  { pattern: "claude-opus-*",   pricing: { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  } },
  { pattern: "claude-sonnet-*", pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  } },
  { pattern: "claude-haiku-*",  pricing: { input: 1.00,  output: 5.00,  cached: 0.10,  reasoning: 5.00,   cache_creation: 1.25  } },
  { pattern: "claude-*",        pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  } },

  // --- Gemini (specific first, generic last) ---
  { pattern: "gemini-*-flash-lite", pricing: { input: 0.15, output: 1.25, cached: 0.015, reasoning: 1.875, cache_creation: 0.15 } },
  { pattern: "gemini-*-flash",  pricing: { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  } },
  { pattern: "gemini-*-pro",    pricing: { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  } },
  { pattern: "gemini-3-*",      pricing: { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  } },
  { pattern: "gemini-2.5-*",    pricing: { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  } },
  { pattern: "gemini-*",        pricing: { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  } },

  // --- GPT (specific first, generic last) ---
  { pattern: "gpt-5.5-pro",     pricing: { input: 30.00, output: 180.00, cached: null, reasoning: 180.00, cache_creation: 30.00 } },
  { pattern: "gpt-5.5",         pricing: { input: 5.00,  output: 30.00, cached: 0.50,  reasoning: 30.00,  cache_creation: 5.00  } },
  { pattern: "gpt-5.4-pro",     pricing: { input: 30.00, output: 180.00, cached: null, reasoning: 180.00, cache_creation: 30.00 } },
  { pattern: "gpt-5.4-mini",    pricing: { input: 0.75,  output: 4.50,  cached: 0.075, reasoning: 4.50,   cache_creation: 0.75  } },
  { pattern: "gpt-5.4-nano",    pricing: { input: 0.20,  output: 1.25,  cached: 0.02,  reasoning: 1.25,   cache_creation: 0.20  } },
  { pattern: "gpt-5.4",         pricing: { input: 2.50,  output: 15.00, cached: 0.25,  reasoning: 15.00,  cache_creation: 2.50  } },
  { pattern: "gpt-5.3-*",       pricing: { input: 6.00,  output: 24.00, cached: 3.00,  reasoning: 36.00,  cache_creation: 6.00  } },
  { pattern: "gpt-5.2-pro",     pricing: { input: 21.00, output: 168.00, cached: null, reasoning: 168.00, cache_creation: 21.00 } },
  { pattern: "gpt-5.2-*",       pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "gpt-5.1-*",       pricing: { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: "gpt-5-pro",       pricing: { input: 15.00, output: 120.00, cached: null, reasoning: 120.00, cache_creation: 15.00 } },
  { pattern: "gpt-5-mini",      pricing: { input: 0.25,  output: 2.00,  cached: 0.025, reasoning: 2.00,   cache_creation: 0.25  } },
  { pattern: "gpt-5-nano",      pricing: { input: 0.05,  output: 0.40,  cached: 0.005, reasoning: 0.40,   cache_creation: 0.05  } },
  { pattern: "gpt-5-*",         pricing: { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: "gpt-5*",          pricing: { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: "gpt-4.1-mini*",   pricing: { input: 0.40,  output: 1.60,  cached: 0.10,  reasoning: 1.60,   cache_creation: 0.40  } },
  { pattern: "gpt-4.1-nano*",   pricing: { input: 0.10,  output: 0.40,  cached: 0.025, reasoning: 0.40,   cache_creation: 0.10  } },
  { pattern: "gpt-4.1*",        pricing: { input: 2.00,  output: 8.00,  cached: 0.50,  reasoning: 8.00,   cache_creation: 2.00  } },
  { pattern: "gpt-4o-mini*",    pricing: { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.60,   cache_creation: 0.15  } },
  { pattern: "gpt-4o-*",        pricing: { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 10.00,  cache_creation: 2.50  } },
  { pattern: "gpt-4o",          pricing: { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 10.00,  cache_creation: 2.50  } },
  { pattern: "gpt-4-turbo*",    pricing: { input: 10.00, output: 30.00, cached: null,  reasoning: 30.00,  cache_creation: 10.00 } },
  { pattern: "gpt-4*",          pricing: { input: 30.00, output: 60.00, cached: null,  reasoning: 60.00,  cache_creation: 30.00 } },

  // --- o1 / o-series ---
  { pattern: "o1-pro",          pricing: { input: 150.00, output: 600.00, cached: null, reasoning: 600.00, cache_creation: 150.00 } },
  { pattern: "o1-mini",         pricing: { input: 1.10,   output: 4.40,   cached: 0.55,  reasoning: 4.40,   cache_creation: 1.10   } },
  { pattern: "o1",              pricing: { input: 15.00,  output: 60.00,  cached: 7.50,  reasoning: 60.00,  cache_creation: 15.00  } },
  { pattern: "o3-pro",          pricing: { input: 20.00,  output: 80.00,  cached: null,  reasoning: 80.00,  cache_creation: 20.00  } },
  { pattern: "o3-mini",         pricing: { input: 1.10,   output: 4.40,   cached: 0.55,  reasoning: 4.40,   cache_creation: 1.10   } },
  { pattern: "o3-*",            pricing: { input: 2.00,   output: 8.00,   cached: 0.50,  reasoning: 8.00,   cache_creation: 2.00   } },
  { pattern: "o3",              pricing: { input: 2.00,   output: 8.00,   cached: 0.50,  reasoning: 8.00,   cache_creation: 2.00   } },
  { pattern: "o4-mini",         pricing: { input: 1.10,   output: 4.40,   cached: 0.275, reasoning: 4.40,   cache_creation: 1.10   } },
  { pattern: "o4-*",            pricing: { input: 1.10,   output: 4.40,   cached: 0.275, reasoning: 4.40,   cache_creation: 1.10   } },

  // --- Qwen ---
  { pattern: "qwen3-coder-*",   pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "qwen*-coder-*",   pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "qwen*",           pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- Kimi ---
  { pattern: "kimi-*-thinking",  pricing: { input: 1.80,  output: 7.20,  cached: 0.90,  reasoning: 10.80,  cache_creation: 1.80  } },
  { pattern: "kimi-k2*",        pricing: { input: 1.20,  output: 4.80,  cached: 0.60,  reasoning: 7.20,   cache_creation: 1.20  } },
  { pattern: "kimi-*",          pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },

  // --- DeepSeek ---
  { pattern: "deepseek-*reasoner*", pricing: { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 } },
  { pattern: "deepseek-r*",     pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },
  { pattern: "deepseek-v*",     pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },
  { pattern: "deepseek-*",      pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },

  // --- GLM ---
  { pattern: "glm-5*",          pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "glm-4*",          pricing: { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  } },
  { pattern: "glm-*",           pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- MiniMax ---
  { pattern: "MiniMax-*",       pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
  { pattern: "minimax-*",       pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- Grok ---
  { pattern: "grok-code-*",     pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
  { pattern: "grok-*",          pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
];

/**
 * Match a model ID against a glob pattern (* = wildcard). Case-insensitive:
 * registry ids mix casing (e.g. "MiniMax-M2.5" vs "minimax-m2.5").
 */
export function matchPattern(pattern, model) {
  const regex = new RegExp("^" + pattern.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
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
  const value = Number(cost || 0);
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  const abs = Math.abs(value);
  if (abs < 0.0001) return `$${value.toFixed(6)}`;
  if (abs < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/**
 * Calculate itemized cost from tokens and pricing.
 *
 * Reasoning tokens reported by OpenAI-compatible APIs are output-token details,
 * not extra billable tokens. Only add separate reasoning cost when a pricing
 * entry explicitly opts into reasoning_billed_separately.
 *
 * @param {object} tokens
 * @param {object} pricing
 * @returns {object} cost breakdown in dollars and tokens
 */
export function calculateCostBreakdownFromTokens(tokens, pricing) {
  if (!tokens || !pricing) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      uncachedPromptTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
      inputCost: 0,
      uncachedInputCost: 0,
      cachedInputCost: 0,
      cacheCreationCost: 0,
      outputCost: 0,
      visibleOutputCost: 0,
      reasoningCost: 0,
      totalCost: 0,
      cacheSavings: 0,
    };
  }

  const readNumber = (...values) => {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  };

  const reportedPromptTokens = readNumber(tokens.prompt_tokens, tokens.input_tokens);
  const cacheReadTokens = readNumber(
    tokens.cache_read_input_tokens,
    tokens.cached_tokens,
    tokens.input_tokens_details?.cached_tokens,
    tokens.prompt_tokens_details?.cached_tokens,
  );
  const cacheCreationTokens = readNumber(
    tokens.cache_creation_input_tokens,
    tokens.input_tokens_details?.cache_creation_tokens,
    tokens.prompt_tokens_details?.cache_creation_tokens,
  );
  const cacheSideTokens = cacheReadTokens + cacheCreationTokens;

  const promptTokensIncludesCache = tokens.prompt_tokens !== undefined || tokens.input_tokens_include_cache === true;
  const promptTokens = promptTokensIncludesCache
    ? reportedPromptTokens
    : reportedPromptTokens + cacheSideTokens;

  const uncachedPromptTokens = promptTokensIncludesCache
    ? Math.max(0, reportedPromptTokens - cacheSideTokens)
    : reportedPromptTokens;

  const completionTokens = readNumber(tokens.completion_tokens, tokens.output_tokens);
  const reasoningTokens = readNumber(
    tokens.reasoning_tokens,
    tokens.output_tokens_details?.reasoning_tokens,
    tokens.completion_tokens_details?.reasoning_tokens,
  );

  const inputRate = pricing.input || 0;
  const cachedRate = pricing.cached ?? inputRate;
  const cacheCreationRate = pricing.cache_creation ?? inputRate;
  const outputRate = pricing.output || 0;
  const reasoningRate = pricing.reasoning ?? outputRate;

  const uncachedInputCost = uncachedPromptTokens * (inputRate / 1000000);
  const cachedInputCost = cacheReadTokens * (cachedRate / 1000000);
  const cacheCreationCost = cacheCreationTokens * (cacheCreationRate / 1000000);
  const inputCost = uncachedInputCost + cachedInputCost + cacheCreationCost;

  const outputCost = completionTokens * (outputRate / 1000000);
  const reasoningBilledSeparately = pricing.reasoning_billed_separately === true;
  const reasoningCost = reasoningTokens * ((reasoningBilledSeparately ? reasoningRate : outputRate) / 1000000);
  const visibleOutputTokens = Math.max(0, completionTokens - reasoningTokens);
  const visibleOutputCost = visibleOutputTokens * (outputRate / 1000000);
  const separateReasoningCost = reasoningBilledSeparately ? reasoningTokens * (reasoningRate / 1000000) : 0;
  const totalCost = inputCost + outputCost + separateReasoningCost;
  const cacheSavings = cacheReadTokens * (Math.max(0, inputRate - cachedRate) / 1000000);

  return {
    promptTokens,
    completionTokens,
    uncachedPromptTokens,
    cacheReadTokens,
    cacheCreationTokens,
    reasoningTokens,
    inputCost,
    uncachedInputCost,
    cachedInputCost,
    cacheCreationCost,
    outputCost,
    visibleOutputCost,
    reasoningCost,
    totalCost,
    cacheSavings,
  };
}

/**
 * Calculate cost from tokens and pricing
 * @param {object} tokens
 * @param {object} pricing
 * @returns {number} cost in dollars
 */
export function calculateCostFromTokens(tokens, pricing) {
  return calculateCostBreakdownFromTokens(tokens, pricing).totalCost;
}
