import { PROVIDERS } from "../providers/index.js";

/**
 * Unwrap Cline's non-stream envelope: {"success":true,"data":{...choices...}}.
 *
 * Scoped to providers opting in via `transport.quirks.clineEnvelope` so no other
 * provider's body is ever rewritten. The error envelope ({"success":false,...})
 * never matches and passes through untouched.
 *
 * @param {object} body - Parsed upstream response body
 * @param {string} provider - Provider id or alias
 * @returns {object} The inner `data` object, or `body` unchanged
 */
export function unwrapClineEnvelope(body, provider) {
  if (!provider || !PROVIDERS[provider]?.quirks?.clineEnvelope) return body;
  const { success, data } = body || {};
  if (success !== true || !data || typeof data !== "object" || Array.isArray(data)) return body;
  return data;
}
