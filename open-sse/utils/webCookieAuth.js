// Cookie-input normalization for web-cookie providers.
// Accepts whatever the user pasted (bare value, `name=value`, full DevTools
// blob, or a cookie-editor JSON array) and produces a `Cookie` header string.

export function stripCookieInputPrefix(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed) return "";

  const withoutBearer = trimmed.replace(/^bearer\s+/i, "");
  return withoutBearer.replace(/^cookie:/i, "").trim();
}

/**
 * Parse a JSON array of cookie objects and produce a Cookie header string.
 *
 * Accepts the format exported by browser cookie-editor extensions / DevTools:
 * [{"name":"sso","value":"eyJ0eXAi...","domain":".example.com","path":"/"}]
 *
 * Only `name` and `value` are required. Extra fields are silently ignored —
 * they describe the cookie but are not part of the `Cookie` request header.
 *
 * Returns null if the input is not JSON (pass-through).
 * Throws on a JSON entry missing the required `name` or `value` field.
 */
export function parseJsonCookiesToHeader(rawValue) {
  const trimmed = (rawValue || "").trim();
  if (!trimmed || !trimmed.startsWith("[")) return null;

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;
  if (parsed.length === 0) return "";

  const parts = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Invalid cookie JSON at index ${i}: expected an object`);
    }
    if (typeof entry.name !== "string" || !entry.name) {
      throw new Error(`Invalid cookie JSON at index ${i}: missing required field 'name'`);
    }
    if (typeof entry.value !== "string") {
      throw new Error(`Invalid cookie JSON at index ${i}: missing required field 'value'`);
    }
    parts.push(`${entry.name}=${entry.value}`);
  }

  return parts.join("; ");
}

export function normalizeSessionCookieHeader(rawValue, defaultCookieName) {
  const stripped = stripCookieInputPrefix(rawValue);
  if (!stripped) return "";

  const jsonResult = parseJsonCookiesToHeader(stripped);
  if (jsonResult !== null) {
    return jsonResult;
  }

  if (stripped.includes("=")) {
    return stripped;
  }

  return `${defaultCookieName}=${stripped}`;
}

/** Cookie attributes that appear in a raw blob but are not name=value pairs. */
const COOKIE_ATTRIBUTE_NAMES = new Set([
  "path",
  "domain",
  "expires",
  "max-age",
  "secure",
  "httponly",
  "samesite",
]);

/**
 * Parse a Cookie header into Playwright `addCookies()` entries.
 *
 * `__Host-` cookies must be host-only (no Domain attribute) — Chrome rejects
 * the whole batch with "Invalid cookie fields" when one carries a domain — and
 * the host must be concrete (no leading dot). Everything else gets `domain`.
 */
export function toPlaywrightCookies(rawValue, defaultDomain) {
  const entries = [];
  for (const part of String(rawValue || "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!name || !value) continue;
    if (COOKIE_ATTRIBUTE_NAMES.has(name.toLowerCase())) continue;

    const bareDomain = String(defaultDomain || "").replace(/^\./, "");
    if (name.startsWith("__Host-")) {
      entries.push({ name, value, domain: bareDomain, path: "/", secure: true });
    } else {
      entries.push({
        name,
        value,
        domain: defaultDomain,
        path: "/",
        secure: true,
      });
    }
  }
  return entries;
}

/**
 * Extract a single cookie's value from whatever the user pasted. Handles:
 *   - bare value:                "eyJ0eXAi..."              → "eyJ0eXAi..."
 *   - single pair:               "sso=eyJ0eXAi..."          → "eyJ0eXAi..."
 *   - full DevTools cookie blob: "foo=1; sso=eyJ...; bar=2" → "eyJ..."
 * Returns "" if a blob is given that does not contain the named cookie.
 */
export function extractCookieValue(rawValue, cookieName) {
  const trimmed = stripCookieInputPrefix(rawValue);
  if (!trimmed) return "";

  if (trimmed.includes(";")) {
    const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = trimmed.match(new RegExp("(?:^|;\\s*)" + escaped + "=([^;\\s]+)"));
    return match ? match[1] : "";
  }

  const prefix = `${cookieName}=`;
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);

  return trimmed;
}

/**
 * Build the `Cookie` header value for grok.com from whatever the user pasted.
 *
 * Always emits `sso=<value>`. When the pasted blob also carries the paired
 * `sso-rw` write cookie, it is forwarded too — Grok's anti-bot rejects requests
 * that send `sso` without `sso-rw`. The Cloudflare cookies `cf_clearance` and
 * `__cf_bm` are forwarded the same way when present. Like `sso-rw`, each is
 * appended only when it appears as a real cookie pair, so a bare `sso` blob
 * still produces exactly `sso=<value>`.
 */
export function buildGrokCookieHeader(rawValue) {
  const sso = extractCookieValue(rawValue, "sso");
  if (!sso) return "";

  const parts = [`sso=${sso}`];
  for (const name of ["sso-rw", "cf_clearance", "__cf_bm"]) {
    if (new RegExp("(?:^|;\\s*)" + name + "=").test(rawValue)) {
      const value = extractCookieValue(rawValue, name);
      if (value) parts.push(`${name}=${value}`);
    }
  }
  return parts.join("; ");
}

/** Extract Kimi Web's current localStorage access token, with legacy cookie compatibility. */

/** Extract Kimi Web refresh_token from key-value, raw string, or localStorage JSON dump. */

/** Extract both access_token and refresh_token from user input. */

export function normalizeSessionCookieHeaders(rawValues, defaultCookieName) {
  const seen = new Set();
  const normalizedHeaders = [];

  for (const rawValue of rawValues) {
    if (typeof rawValue !== "string") continue;
    const normalized = normalizeSessionCookieHeader(rawValue, defaultCookieName);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedHeaders.push(normalized);
  }

  return normalizedHeaders;
}
