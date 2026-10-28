// Provider icon paths under /public/providers.
// Alias related brands; session-cache 404s so one miss never spams again.

const ICON_ALIASES = {
  "perplexity-agent": "perplexity",
  "gitlab-duo": "gitlab",
  "vercel-ai-gateway": "vercel",
  "ollama-search": "ollama",
  // MiniMax Code rides the existing MiniMax brand mark
  "minimax-code": "minimax",
  "minimax-code-global": "minimax",
  // Zen is the same opencode.ai brand
  "opencode-zen": "opencode",
  // Web-cookie variants ride their brand's existing mark
  "deepseek-web": "deepseek",
  "muse-web": "muse",
  "gemini-web": "gemini",
  "chatgpt-web": "openai",
};

// Runtime only — first 404 remembers id for the whole session
const failedIds = new Set();

function normalizeId(providerId) {
  if (!providerId || typeof providerId !== "string") return "";
  return providerId.trim().toLowerCase();
}

/** Resolve icon file id (after alias). Empty if previously failed this session. */
export function resolveProviderIconId(providerId) {
  const id = normalizeId(providerId);
  if (!id) return "";
  if (failedIds.has(id)) return "";
  const compatibleBrand = id.startsWith("anthropic-compatible") ? "anthropic"
    : id.startsWith("openai-compatible") || id.startsWith("custom-embedding") ? "openai" : null;
  const aliased = compatibleBrand || ICON_ALIASES[id] || id;
  if (failedIds.has(aliased)) return "";
  return aliased;
}

/** `/providers/{id}.png` or null when previously failed. */
export function getProviderIconSrc(providerId) {
  const id = resolveProviderIconId(providerId);
  return id ? `/providers/${id}.png` : null;
}

/** Call from img onError so later mounts skip the request. */
export function markProviderIconMissing(providerId) {
  const id = normalizeId(providerId);
  if (id) failedIds.add(id);
  const aliased = ICON_ALIASES[id];
  if (aliased) failedIds.add(aliased);
}
