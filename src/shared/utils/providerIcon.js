// Provider icon paths under /public/providers.
// Alias related brands; session-cache 404s so one miss never spams again.

const ICON_ALIASES = {
  "perplexity-agent": "perplexity",
  "gitlab-duo": "gitlab",
  "vercel-ai-gateway": "vercel",
  "ollama-search": "ollama",
  "deepseek-web": "deepseek",
  "gemini-web": "gemini",
  "kimi-web": "kimi",
};

const TYPE_PREFIX_ALIASES = {
  "openai-compatible-": "openai",
  "anthropic-compatible-": "anthropic",
  "custom-embedding-": "selfhosted-embedding",
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
  let aliased = ICON_ALIASES[id] || id;
  for (const [prefix, target] of Object.entries(TYPE_PREFIX_ALIASES)) {
    if (aliased.startsWith(prefix)) {
      aliased = target;
      break;
    }
  }
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
