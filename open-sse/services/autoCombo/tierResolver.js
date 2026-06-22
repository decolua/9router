// AutoCombo tier resolver — maps provider+model to a cost tier.
// Pure function; no side effects.

// Known model → { tier, costPerMTok }
// costPerMTok is approximate USD per 1 M output tokens.
const MODEL_MAP = {
  // Anthropic
  "claude-opus-4":       { tier: "premium", costPerMTok: 75 },
  "claude-opus-3":       { tier: "premium", costPerMTok: 75 },
  "claude-sonnet-4":     { tier: "premium", costPerMTok: 15 },
  "claude-sonnet-4.5":   { tier: "premium", costPerMTok: 15 },
  "claude-sonnet-4.6":   { tier: "premium", costPerMTok: 15 },
  "claude-sonnet-3.5":   { tier: "premium", costPerMTok: 15 },
  "claude-haiku-3.5":    { tier: "cheap",   costPerMTok: 1.25 },
  "claude-haiku-3":      { tier: "cheap",   costPerMTok: 1.25 },

  // OpenAI
  "gpt-4o":              { tier: "premium", costPerMTok: 15 },
  "gpt-4o-mini":         { tier: "cheap",   costPerMTok: 0.6 },
  "gpt-4-turbo":         { tier: "premium", costPerMTok: 30 },
  "gpt-4":               { tier: "premium", costPerMTok: 60 },
  "gpt-3.5-turbo":       { tier: "cheap",   costPerMTok: 2 },
  "o1":                  { tier: "premium", costPerMTok: 60 },
  "o1-mini":             { tier: "cheap",   costPerMTok: 12 },
  "o3":                  { tier: "premium", costPerMTok: 60 },
  "o3-mini":             { tier: "cheap",   costPerMTok: 4.4 },
  "o4-mini":             { tier: "cheap",   costPerMTok: 4.4 },

  // Google
  "gemini-2.5-pro":      { tier: "premium", costPerMTok: 10 },
  "gemini-2.0-flash":    { tier: "cheap",   costPerMTok: 0.4 },
  "gemini-1.5-pro":      { tier: "premium", costPerMTok: 10.5 },
  "gemini-1.5-flash":    { tier: "cheap",   costPerMTok: 0.35 },

  // xAI
  "grok-3":              { tier: "premium", costPerMTok: 15 },
  "grok-3-mini":         { tier: "cheap",   costPerMTok: 0.9 },
  "grok-beta":           { tier: "premium", costPerMTok: 15 },

  // Meta / Llama (self-hosted / free-tier hosts)
  "llama-3.3-70b":       { tier: "free",    costPerMTok: 0 },
  "llama-3.1-70b":       { tier: "free",    costPerMTok: 0 },
  "llama-3.1-8b":        { tier: "free",    costPerMTok: 0 },
  "llama-3-70b":         { tier: "free",    costPerMTok: 0 },
  "llama-3-8b":          { tier: "free",    costPerMTok: 0 },
  "llama-2-70b":         { tier: "free",    costPerMTok: 0 },
  "llama-2-7b":          { tier: "free",    costPerMTok: 0 },

  // DeepSeek
  "deepseek-r1":         { tier: "cheap",   costPerMTok: 2.19 },
  "deepseek-chat":       { tier: "cheap",   costPerMTok: 0.28 },
  "deepseek-reasoner":   { tier: "cheap",   costPerMTok: 2.19 },
};

// Provider-level fallbacks when model is unknown.
const PROVIDER_MAP = {
  anthropic:  { tier: "premium", costPerMTok: 15 },
  openai:     { tier: "premium", costPerMTok: 15 },
  google:     { tier: "cheap",   costPerMTok: 1 },
  xai:        { tier: "premium", costPerMTok: 15 },
  meta:       { tier: "free",    costPerMTok: 0 },
  ollama:     { tier: "free",    costPerMTok: 0 },
  lmstudio:   { tier: "free",    costPerMTok: 0 },
  groq:       { tier: "cheap",   costPerMTok: 0.9 },
  together:   { tier: "cheap",   costPerMTok: 1.2 },
  deepseek:   { tier: "cheap",   costPerMTok: 1 },
  mistral:    { tier: "cheap",   costPerMTok: 2 },
  cohere:     { tier: "cheap",   costPerMTok: 2 },
  perplexity: { tier: "cheap",   costPerMTok: 1 },
};

const FALLBACK = { tier: "cheap", costPerMTok: 1 };

// Pre-sorted descending by key length so longer keys (e.g. "gpt-4o-mini") win
// over shorter prefixes (e.g. "gpt-4o") in the startsWith scan below.
const MODEL_ENTRIES = Object.entries(MODEL_MAP).sort((a, b) => b[0].length - a[0].length);

/**
 * Resolve a provider+model pair to a tier and approximate cost.
 *
 * @param {string} provider  e.g. "anthropic", "openai"
 * @param {string} model     e.g. "claude-sonnet-4.6", "gpt-4o"
 * @returns {{ tier: 'free'|'cheap'|'premium', costPerMTok: number }}
 */
export function classifyTier(provider, model) {
  // Exact model match (strip provider prefix if present, e.g. "anthropic/claude-sonnet-4.6")
  const bare = (model || "").replace(/^[^/]+\//, "").toLowerCase();
  if (bare && MODEL_MAP[bare]) return MODEL_MAP[bare];

  // Prefix-match longest key first so "gpt-4o-mini" beats "gpt-4o"
  for (const [key, val] of MODEL_ENTRIES) {
    if (bare.startsWith(key)) return val;
  }

  // Provider-level fallback
  const prov = (provider || "").toLowerCase();
  if (PROVIDER_MAP[prov]) return PROVIDER_MAP[prov];

  return FALLBACK;
}
