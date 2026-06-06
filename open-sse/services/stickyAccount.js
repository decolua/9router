/**
 * Sticky-account routing for prompt-cache continuity.
 *
 * Many providers cache prompt prefixes per account. When 9router fans a
 * coding-agent session across multiple accounts of the same provider, each
 * switch invalidates the cache and re-bills the prefix. By remembering which
 * connectionId last succeeded for a given session (provider/model + stable
 * conversation fingerprint), we can ask the auth layer to prefer that account
 * on subsequent turns. Auth still falls back to other accounts when the
 * preferred one is locked or excluded.
 *
 * Scope: per (provider/model + session). A session is identified by the stable
 * leading text of the conversation (system prompt + first user turn).
 */

import { deriveNamespacedSessionKey } from "../utils/sessionFingerprint.js";

/** @type {Map<string, { connectionId: string, lastUsed: number }>} */
const stickyAccountStore = new Map();

const STICKY_TTL_MS = 90 * 60 * 1000; // 90 min idle
const STICKY_MAX_ENTRIES = 5000;

const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of stickyAccountStore) {
    if (now - entry.lastUsed > STICKY_TTL_MS) stickyAccountStore.delete(key);
  }
}, 5 * 60 * 1000);
if (cleanup.unref) cleanup.unref();

function buildNamespace(provider, model) {
  return `acct::${provider || "?"}/${model || "?"}`;
}

/**
 * Derive a session key for sticky-account routing.
 * @param {Object} body
 * @param {string} provider
 * @param {string} model
 * @returns {string|null}
 */
export function deriveStickyAccountKey(body, provider, model) {
  return deriveNamespacedSessionKey(body, buildNamespace(provider, model));
}

/**
 * Get the connectionId previously pinned for this session, if any.
 * @param {string|null} key
 * @returns {string|null}
 */
export function getStickyAccount(key) {
  if (!key) return null;
  const entry = stickyAccountStore.get(key);
  if (!entry) return null;
  entry.lastUsed = Date.now();
  return entry.connectionId;
}

/**
 * Pin the given connectionId to the session.
 * @param {string|null} key
 * @param {string|null} connectionId
 */
export function setStickyAccount(key, connectionId) {
  if (!key || !connectionId) return;
  if (!stickyAccountStore.has(key) && stickyAccountStore.size >= STICKY_MAX_ENTRIES) {
    const oldest = stickyAccountStore.keys().next().value;
    if (oldest !== undefined) stickyAccountStore.delete(oldest);
  }
  stickyAccountStore.set(key, { connectionId, lastUsed: Date.now() });
}

/**
 * Clear the pinned connection (e.g. when it became unavailable for this turn).
 * @param {string|null} key
 */
export function clearStickyAccount(key) {
  if (!key) return;
  stickyAccountStore.delete(key);
}

/**
 * Reset all sticky-account state (testing / explicit reset).
 * @param {string} [key]
 */
export function resetStickyAccountStore(key) {
  if (key) stickyAccountStore.delete(key);
  else stickyAccountStore.clear();
}
