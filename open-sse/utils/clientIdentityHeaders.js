// open-sse/utils/clientIdentityHeaders.js
// Selective passthrough: only re-inject the client's identity fingerprint headers
// upstream. Never forwards auth/transport headers (authorization, x-api-key,
// host, content-length, content-type, accept). Never overwrites headers that
// 9router itself manages.

// Allowlisted client identity headers (lowercase)
export const CLIENT_IDENTITY_HEADERS = new Set([
  "user-agent",
  "originator",
  "openai-beta",
  "anthropic-beta",
  "anthropic-version",
  "x-app",
  "anthropic-dangerous-direct-browser-access",
  "chatgpt-account-id",
  "oai-organization",
  "openai-organization",
  "x-request-id",
  "x-client-request-id",
  "x-codex-beta-features",
  "x-codex-turn-metadata",
  "x-openai-subagent",
  "x-stainless-lang",
  "x-stainless-package-version",
  "x-stainless-os",
  "x-stainless-arch",
  "x-stainless-runtime",
  "session_id",
]);

function hasHeaderCaseInsensitive(headers, name) {
  const lk = String(name).toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lk);
}

/**
 * Re-inject inbound client identity headers into the outbound header set,
 * filtered by an allowlist.
 * - Only fills a header when it is not already set by 9router (so 9router-managed
 *   auth / own fingerprints always win).
 * - Case-insensitive de-dup to avoid two naming variants of the same header.
 * @param {Record<string,string>} headers outbound headers (mutated in place)
 * @param {object} credentials carries rawHeaders (the inbound request headers)
 */
export function mergeInboundClientIdentityHeaders(headers, credentials) {
  const fwd = credentials && credentials.rawHeaders;
  if (!fwd || typeof fwd !== "object") return;
  for (const [k, v] of Object.entries(fwd)) {
    const lk = String(k).toLowerCase();
    if (!CLIENT_IDENTITY_HEADERS.has(lk)) continue; // allowlist only
    if (v == null) continue;
    if (hasHeaderCaseInsensitive(headers, k)) continue; // never clobber 9router's own
    headers[k] = Array.isArray(v) ? v[0] : v;
  }
}
