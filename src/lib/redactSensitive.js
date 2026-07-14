/**
 * Sensitive-value redaction for log lines and serialized objects.
 *
 * Used as a defense-in-depth layer in front of the console-log buffer
 * (dashboard /console-log) and as a shared helper. Pino has its own
 * structured `redact.paths`, but raw `console.*` calls bypass that, so we
 * sanitize log lines here as well.
 *
 * Strategy: operate on the already-stringified log line and scrub the
 * common ways secrets appear:
 *   - `Authorization: Bearer <token>` (JWT or opaque, >= 16 chars)
 *   - JSON-style `"key":"value"` where key is a known sensitive field
 *   - bare `key=value` / `key: value` where key is a known sensitive field
 */

const CENSOR = "[REDACTED]";

// Sensitive field names (case-insensitive). Keep in sync with Pino redact paths.
const SENSITIVE_KEYS = [
  "authorization",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "clientsecret",
  "client_secret",
  "password",
  "token",
  "apikey",
  "api_key",
  "authtoken",
  "auth_token",
  "cookie",
  "secret",
];

// Build alternation once. Longer keys first so e.g. refresh_token wins over token.
const KEY_ALTERNATION = SENSITIVE_KEYS
  .slice()
  .sort((a, b) => b.length - a.length)
  .join("|");

// `Authorization: Bearer <value>` or bare `Bearer <value>` (token >= 16 chars).
const BEARER_RE = /(Bearer\s+)([A-Za-z0-9._\-+/=]{16,})/gi;

// JSON-style "key":"value"
const JSON_KV_RE = new RegExp(`("(?:${KEY_ALTERNATION})"\\s*:\\s*)"[^"]*"`, "gi");

// Bare key=value or key: value (value = non-space run, length >= 8 to avoid noise).
const BARE_KV_RE = new RegExp(`\\b(${KEY_ALTERNATION})(\\s*[:=]\\s*)([^\\s",}]{8,})`, "gi");

/**
 * Redact sensitive values from a log line / string.
 * Non-string inputs are returned unchanged.
 * @param {*} value
 * @returns {*}
 */
export function redactSensitive(value) {
  if (typeof value !== "string") return value;
  let out = value;
  out = out.replace(BEARER_RE, (_m, prefix) => `${prefix}${CENSOR}`);
  out = out.replace(JSON_KV_RE, (_m, keyPart) => `${keyPart}"${CENSOR}"`);
  out = out.replace(BARE_KV_RE, (_m, key, sep) => `${key}${sep}${CENSOR}`);
  return out;
}

export default redactSensitive;
