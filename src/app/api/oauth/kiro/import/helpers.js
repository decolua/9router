/**
 * Helpers for the bulk Kiro refresh-token import endpoint.
 *
 * Extracted from `route.js` so they can be unit-tested without spinning up a
 * Next.js request lifecycle. Next.js treats every named export from a route
 * file as a route method, so non-method helpers must live in a sibling file.
 */

/**
 * Normalise the inbound POST payload into a deduplicated, trimmed token list.
 *
 * Accepts:
 *   { refreshToken: "aorAAAAAG..." }
 *   { refreshToken: "aorAAAAAG...\naorAAAAAG..." }      // newline / comma / semicolon separated
 *   { refreshTokens: ["aorAAAAAG...", "aorAAAAAG..."] }
 *   { refreshTokens: "aorAAAAAG...\naorAAAAAG..." }
 *
 * @param {unknown} payload  Parsed JSON body.
 * @returns {string[]} Deduplicated, trimmed, non-empty refresh tokens.
 */
export function collectRefreshTokens(payload) {
  if (!payload || typeof payload !== "object") return [];

  const raw = [];
  if (Array.isArray(payload.refreshTokens)) {
    for (const t of payload.refreshTokens) {
      if (typeof t === "string") raw.push(t);
    }
  } else if (typeof payload.refreshTokens === "string") {
    raw.push(...splitTokens(payload.refreshTokens));
  }

  if (typeof payload.refreshToken === "string") {
    raw.push(...splitTokens(payload.refreshToken));
  }

  const seen = new Set();
  const out = [];
  for (const t of raw) {
    const trimmed = t.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * Split a string of tokens. Tolerates any whitespace, commas, or semicolons
 * between tokens so users can paste from spreadsheets, env files, or Kiro's
 * `kiro-auth-token.json`.
 */
export function splitTokens(input) {
  return input
    .split(/[\s,;]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Mask a refresh token for inclusion in API responses and logs. Keeps the
 * leading 8 chars (provider prefix) and the last 4 chars (rotation hint), so
 * users can identify which token was processed without leaking the full value.
 */
export function maskToken(token) {
  if (typeof token !== "string" || token.length < 12) return "***";
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}
