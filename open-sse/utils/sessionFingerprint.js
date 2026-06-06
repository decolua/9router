/**
 * Conversation fingerprinting for sticky routing (combo model & account).
 *
 * Coding agents run multi-turn sessions where each turn references tool_use /
 * tool_call_id values produced earlier. To keep continuity (combo) and to
 * preserve provider-side prompt caches (account), we identify a session by
 * hashing its stable leading text — the system prompt and the first user turn,
 * which do not change as the conversation grows.
 */

import crypto from "crypto";

/**
 * True when the request carries tool definitions (coding-agent style request).
 * @param {Object} body
 * @returns {boolean}
 */
export function requestHasTools(body) {
  return Array.isArray(body?.tools) && body.tools.length > 0;
}

function pushText(parts, content) {
  if (typeof content === "string") {
    parts.push(content);
  } else if (Array.isArray(content)) {
    for (const c of content) {
      if (typeof c === "string") parts.push(c);
      else if (c && typeof c.text === "string") parts.push(c.text);
    }
  }
}

/**
 * Collect the stable leading text of a conversation. Uses the system prompt
 * plus the first user turn so the same session maps to the same fingerprint
 * across turns, regardless of how the conversation grows. A total-length line
 * is appended so two near-identical texts of different lengths do not collide.
 * @param {Object} body
 * @returns {string}
 */
function collectFingerprintSource(body) {
  const parts = [];

  // Claude-style top-level system prompt
  if (typeof body?.system === "string") parts.push(body.system);
  else if (Array.isArray(body?.system)) pushText(parts, body.system);

  const items = Array.isArray(body?.messages) ? body.messages
    : Array.isArray(body?.input) ? body.input
    : [];

  const firstSystem = items.find(m => m?.role === "system" || m?.role === "developer");
  if (firstSystem) pushText(parts, firstSystem.content);

  const firstUser = items.find(m => m?.role === "user");
  if (firstUser) pushText(parts, firstUser.content);

  // Append a stable total-length signal so near-identical anchor texts of
  // different lengths hash differently. Only when there is real anchor text,
  // otherwise an empty body must stay empty so callers can skip sticky routing.
  const totalChars = parts.reduce((sum, p) => sum + p.length, 0);
  if (totalChars > 0) parts.push(`len:${totalChars}`);

  return parts.join("\n");
}

/**
 * Derive a stable fingerprint hex string for a conversation, or null when
 * there is no usable anchor text (caller should skip sticky routing).
 * @param {Object} body
 * @returns {string|null}
 */
export function deriveSessionFingerprint(body) {
  const source = collectFingerprintSource(body);
  if (!source.trim()) return null;
  return crypto.createHash("sha256").update(source).digest("hex").slice(0, 32);
}

/**
 * Convenience: namespaced session key built on top of the fingerprint.
 * @param {Object} body
 * @param {string} namespace - e.g. combo name or `${provider}/${model}`
 * @returns {string|null}
 */
export function deriveNamespacedSessionKey(body, namespace) {
  const fp = deriveSessionFingerprint(body);
  if (!fp) return null;
  return `${namespace || "__default__"}::${fp}`;
}
