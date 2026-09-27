// Legacy local-mode placeholder. It never exists in the apiKeys table, so the
// gateway rejects it whenever requireApiKey is on (the default) — last resort only.
export const CLI_PLACEHOLDER_API_KEY = "sk_9router";

const firstActiveKey = (apiKeys) =>
  (Array.isArray(apiKeys) ? apiKeys.find((k) => k?.key && k.isActive !== false)?.key : "") || "";

// Key a CLI tool config should carry: the explicit selection, else the first dashboard
// key (what ApiKeySelect renders for an empty value), else the placeholder / fallback.
export function resolveCliApiKey(selectedApiKey, apiKeys, { cloudEnabled = false, fallback = null } = {}) {
  const selected = typeof selectedApiKey === "string" ? selectedApiKey.trim() : "";
  if (selected && selected !== CLI_PLACEHOLDER_API_KEY) return selected;
  const first = firstActiveKey(apiKeys);
  if (first) return first;
  return selected || (!cloudEnabled ? CLI_PLACEHOLDER_API_KEY : fallback);
}
