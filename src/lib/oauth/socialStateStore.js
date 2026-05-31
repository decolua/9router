const DEFAULT_TTL_MS = 10 * 60 * 1000;
const stateStore = new Map();

function nowMs() {
  return Date.now();
}

function cleanupExpired(ttlMs = DEFAULT_TTL_MS) {
  const cutoff = nowMs() - ttlMs;
  for (const [state, record] of stateStore.entries()) {
    if ((record.createdAt || 0) < cutoff) {
      stateStore.delete(state);
    }
  }
}

export function saveSocialOAuthState(state, data, ttlMs = DEFAULT_TTL_MS) {
  cleanupExpired(ttlMs);
  stateStore.set(state, {
    ...data,
    createdAt: nowMs(),
  });
}

export function consumeSocialOAuthState(state, { provider, ttlMs = DEFAULT_TTL_MS } = {}) {
  cleanupExpired(ttlMs);
  const record = stateStore.get(state);
  if (!record) return null;
  stateStore.delete(state);
  if (provider && record.provider !== provider) return null;
  if ((record.createdAt || 0) < nowMs() - ttlMs) return null;
  return record;
}

export function clearSocialOAuthStates() {
  stateStore.clear();
}
