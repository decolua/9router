const INVISIBLE_CHARS_REGEX = /[\u200B\u200C\u200D\u2060\uFEFF]/g;
const NON_LATIN1_REGEX = /[^\x00-\xFF]/;

/**
 * Sanitize header value:
 * 1. Remove invisible chars: U+200B, U+200C, U+200D, U+2060, U+FEFF.
 * 2. Trim leading/trailing whitespace.
 * 3. Leave values in 0x00-0xFF unchanged.
 * 4. Throw if char > 0xFF remains, without leaking value.
 */
function cleanValue(name, val) {
  if (typeof val !== "string") return val;
  const cleaned = val.replace(INVISIBLE_CHARS_REGEX, "").trim();
  if (NON_LATIN1_REGEX.test(cleaned)) {
    throw new Error(
      `Invalid character in header "${name}": header values must be Latin-1; check for a pasted key with stray characters`
    );
  }
  return cleaned;
}

/**
 * Clean stray invisible characters and validate header values.
 * Accepts plain object or Headers instance. Returns matching type.
 */
export function sanitizeHeaderValues(headers) {
  if (!headers) return headers;

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    const out = new Headers();
    for (const [k, v] of headers.entries()) {
      out.set(k, cleanValue(k, v));
    }
    return out;
  }

  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = cleanValue(k, v);
  }
  return out;
}
