/**
 * Minimal in-memory cascade pool. Reuses cascade_id across multi-turn
 * conversations sharing the same {account, model, tool-schema, LS} so we
 * skip the StartCascade roundtrip and let Windsurf prefix-cache.
 *
 * Adapted from dwgx/WindsurfAPI/src/conversation-pool.js (Phase 3.3 minimal).
 */
const TTL_MS = 10 * 60 * 1000;
const _pool = new Map(); // key -> { cascadeId, lastUsed, lsPort, lsGeneration }

export function cascadeKey({ accountId, model, toolDigest, lsPort, lsGeneration }) {
  return [
    String(accountId || ""),
    String(model || ""),
    String(toolDigest || "no-tools"),
    String(lsPort || ""),
    String(lsGeneration || ""),
  ].join("|");
}

function evictExpired(now = Date.now()) {
  for (const [k, e] of _pool) {
    if (now - e.lastUsed > TTL_MS) _pool.delete(k);
  }
}

export function checkout(key) {
  if (!key) return null;
  evictExpired();
  const entry = _pool.get(key);
  if (!entry) return null;
  if (Date.now() - entry.lastUsed > TTL_MS) {
    _pool.delete(key);
    return null;
  }
  return { cascadeId: entry.cascadeId, lastUsed: entry.lastUsed };
}

export function checkin(key, cascadeId, meta = {}) {
  if (!key || !cascadeId) return;
  _pool.set(key, {
    cascadeId,
    lastUsed: Date.now(),
    lsPort: meta.lsPort || null,
    lsGeneration: meta.lsGeneration || null,
  });
  evictExpired();
}

export function invalidate(key) {
  if (!key) return;
  _pool.delete(key);
}

export function invalidateForLs(lsPort, lsGeneration) {
  let dropped = 0;
  for (const [k, e] of _pool) {
    if (lsPort && e.lsPort === lsPort) {
      if (lsGeneration == null || e.lsGeneration == null || e.lsGeneration === lsGeneration) {
        _pool.delete(k);
        dropped++;
      }
    }
  }
  return dropped;
}

export function _poolSize() { return _pool.size; }
