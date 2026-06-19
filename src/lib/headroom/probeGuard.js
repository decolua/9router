// Headroom probe URL validation — loopback-only by default to prevent SSRF.
// Extracted from src/app/api/headroom/probe/route.js so the validation is
// importable in unit tests.

export const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
export const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Allowlist for non-loopback hosts (admin-configured via settings, future).
// Currently empty — only loopback is allowed.
export const REMOTE_HOST_ALLOWLIST = new Set([]);

/**
 * Validate a probe URL: only loopback hostnames are allowed (SSRF guard).
 * Returns `{ ok: true, url }` with a parsed URL on success, or
 * `{ ok: false, error }` with a human-readable error on rejection.
 */
export function validateProbeUrl(input) {
  if (!input || typeof input !== "string") {
    return { ok: false, error: "URL required" };
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, error: `Scheme "${parsed.protocol}" not allowed (http/https only)` };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(hostname) || REMOTE_HOST_ALLOWLIST.has(hostname)) {
    return { ok: true, url: parsed };
  }
  return { ok: false, error: `Host "${hostname}" not allowed — probe is loopback-only. Set headroomUrl manually for remote servers.` };
}
