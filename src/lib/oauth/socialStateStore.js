const DEFAULT_TTL_MS = 10 * 60 * 1000;
// Hard cap on stored states. The writer (/social-authorize) is unauthenticated,
// so an attacker could otherwise grow this Map without bound (memory DoS). When
// the cap is hit we evict the oldest entry before inserting. 5000 pending logins
// is far beyond any legitimate concurrent use.
const MAX_ENTRIES = 5000;
// Full-scan cleanup is O(n); throttle it so a burst of writes can't turn each
// save into an O(n) sweep (effectively O(n^2) over the window). Expired entries
// are also rejected lazily on read, so correctness never depends on the sweep.
const CLEANUP_INTERVAL_MS = 30 * 1000;

const stateStore = new Map();
let lastCleanup = 0;

function nowMs() {
  return Date.now();
}

function cleanupExpired(ttlMs = DEFAULT_TTL_MS, force = false) {
  const now = nowMs();
  if (!force && now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  const cutoff = now - ttlMs;
  for (const [state, record] of stateStore.entries()) {
    if ((record.createdAt || 0) < cutoff) {
      stateStore.delete(state);
    }
  }
}

function evictOldest() {
  // Map preserves insertion order; the first key is the oldest insert.
  const oldest = stateStore.keys().next();
  if (!oldest.done) stateStore.delete(oldest.value);
}

export function saveSocialOAuthState(state, data, ttlMs = DEFAULT_TTL_MS) {
  cleanupExpired(ttlMs);
  if (stateStore.size >= MAX_ENTRIES) {
    cleanupExpired(ttlMs, true);
    while (stateStore.size >= MAX_ENTRIES) evictOldest();
  }
  stateStore.set(state, {
    ...data,
    createdAt: nowMs(),
  });
}

export function consumeSocialOAuthState(state, { provider, ttlMs = DEFAULT_TTL_MS } = {}) {
  // Lazy expiry on read guarantees correctness regardless of sweep throttling.
  const record = stateStore.get(state);
  if (!record) return null;
  // Single-use: delete on first consume so a replayed state is rejected.
  stateStore.delete(state);
  if ((record.createdAt || 0) < nowMs() - ttlMs) return null;
  if (provider && record.provider !== provider) return null;
  return record;
}

export function clearSocialOAuthStates() {
  stateStore.clear();
  lastCleanup = 0;
}
