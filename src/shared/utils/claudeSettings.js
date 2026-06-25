export function normalizeClaudeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  const withoutSlash = raw.replace(/\/+$/, "");
  return withoutSlash.endsWith("/v1")
    ? withoutSlash.slice(0, -3).replace(/\/+$/, "")
    : withoutSlash;
}
