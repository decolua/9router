/**
 * Session → Account binding store.
 *
 * Goal: keep a single client conversation (session id) pinned to one upstream
 * account so that (a) the provider-side prompt cache stays warm, which is the
 * whole reason to prefer session binding over naive round-robin, and (b) several
 * concurrent client requests from DIFFERENT sessions spread across accounts
 * instead of all stampeding the same one.
 *
 * This is intentionally an in-process Map with a TTL sweep. It does NOT need to be
 * durable: a lost binding at process restart merely costs one cache miss. Keeping it
 * in memory avoids per-request DB writes on the hot path.
 *
 * Invariants:
 *   - One session id maps to at most one connectionId per provider.
 *   - A connection has at most `maxSessionsPerAccount` sessions (soft or hard cap).
 *   - Idle sessions are released so an account can serve new sessions.
 *   - When a binding's account becomes unavailable, the binding is moved (not left
 *     dangling) AND its load slot is drained so no phantom concurrency remains.
 */

import { drainLoad, getLoad } from "./accountLoad.js";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_MS = 5 * 60 * 1000;

/**
 * Hard ceiling on tracked sessions. The TTL sweep alone is not enough: clients
 * that mint a fresh session id per request (e.g. a rotating prompt_cache_key)
 * would grow this Map monotonically for a full TTL window. When the ceiling is
 * hit we evict the least-recently-seen entries, which is exactly the set whose
 * upstream prompt cache is most likely already cold.
 */
const MAX_BINDINGS = 20000;
const EVICT_BATCH = 2000;

// sessionKey (providerId + "\u0000" + sessionId) -> { connectionId, providerId, sessionId, lastSeenAt, createdAt }
const bindings = new Map();
// connectionId -> Set<sessionKey>
const byConnection = new Map();

let sweepTimer = null;
let sweepTtlMs = DEFAULT_TTL_MS;
let sweepIntervalMs = DEFAULT_SWEEP_MS;

function sessionKey(providerId, sessionId) {
  return `${providerId}\u0000${sessionId}`;
}

function touch(entry) {
  entry.lastSeenAt = Date.now();
}

/** Detach a key from its connection index, cleaning up empty sets. */
function detachKey(key, connectionId) {
  const set = byConnection.get(connectionId);
  if (!set) return;
  set.delete(key);
  if (set.size === 0) byConnection.delete(connectionId);
}

/**
 * Evict the least-recently-seen bindings once the hard ceiling is reached.
 * O(n log n) but amortised: only runs when the Map is already at MAX_BINDINGS.
 */
function evictLeastRecentlyUsed() {
  if (bindings.size < MAX_BINDINGS) return 0;
  const entries = [...bindings.entries()].sort((a, b) => a[1].lastSeenAt - b[1].lastSeenAt);
  const target = Math.min(EVICT_BATCH, entries.length);
  for (let i = 0; i < target; i += 1) {
    const [key, entry] = entries[i];
    bindings.delete(key);
    detachKey(key, entry.connectionId);
  }
  return target;
}

/**
 * Look up the account currently bound to a session.
 * @returns {string|null} connectionId
 */
export function getBoundConnection(providerId, sessionId) {
  if (!providerId || !sessionId) return null;
  const key = sessionKey(providerId, sessionId);
  const entry = bindings.get(key);
  if (!entry) return null;
  touch(entry);
  return entry.connectionId;
}

/**
 * How many sessions are currently bound to a connection.
 */
export function getSessionCount(connectionId) {
  return byConnection.get(connectionId)?.size || 0;
}

/**
 * Bind a session to a connection, replacing any previous binding.
 * If the session was previously bound elsewhere, the old connection's session set
 * is cleaned up. If the old connection now has zero sessions AND zero in-flight
 * load, its load slot is drained to avoid a phantom.
 *
 * @returns {{ connectionId: string, moved: boolean, previousConnectionId: string|null }}
 */
export function bindSession(providerId, sessionId, connectionId) {
  if (!providerId || !sessionId || !connectionId) {
    return { connectionId: connectionId || null, moved: false, previousConnectionId: null };
  }
  const key = sessionKey(providerId, sessionId);
  const existing = bindings.get(key);
  const previousConnectionId = existing?.connectionId || null;

  if (previousConnectionId && previousConnectionId !== connectionId) {
    const set = byConnection.get(previousConnectionId);
    if (set) {
      set.delete(key);
      if (set.size === 0) {
        byConnection.delete(previousConnectionId);
        // No sessions left on the old account: drop any leftover load accounting
        // so a later acquire() is not blocked by a stale count.
        if (getLoad(previousConnectionId) === 0) drainLoad(previousConnectionId);
      }
    }
  }

  // Enforce the ceiling only when inserting a genuinely new key, so refreshing an
  // existing hot session never triggers an eviction pass.
  if (!existing) evictLeastRecentlyUsed();

  const now = Date.now();
  bindings.set(key, {
    connectionId,
    providerId,
    sessionId,
    lastSeenAt: now,
    createdAt: existing?.createdAt || now,
  });

  let set = byConnection.get(connectionId);
  if (!set) {
    set = new Set();
    byConnection.set(connectionId, set);
  }
  set.add(key);

  return { connectionId, moved: !!previousConnectionId && previousConnectionId !== connectionId, previousConnectionId };
}

/**
 * Remove a session binding explicitly (e.g. its account got locked and the caller
 * cannot find a replacement right now).
 */
export function unbindSession(providerId, sessionId) {
  if (!providerId || !sessionId) return false;
  const key = sessionKey(providerId, sessionId);
  const entry = bindings.get(key);
  if (!entry) return false;
  bindings.delete(key);
  detachKey(key, entry.connectionId);
  return true;
}

/**
 * Release every binding pointing at a connection (used when an account is frozen
 * or deleted). Returns the affected session keys so callers can re-route them.
 */
export function releaseConnectionBindings(connectionId) {
  const set = byConnection.get(connectionId);
  if (!set) return [];
  const released = [...set];
  for (const key of released) bindings.delete(key);
  byConnection.delete(connectionId);
  drainLoad(connectionId);
  return released;
}

/** Sweep bindings idle for longer than ttlMs. Returns count evicted. */
export function sweepIdleBindings(ttlMs = sweepTtlMs) {
  const now = Date.now();
  let evicted = 0;
  for (const [key, entry] of bindings) {
    if (now - entry.lastSeenAt > ttlMs) {
      bindings.delete(key);
      detachKey(key, entry.connectionId);
      evicted += 1;
    }
  }
  return evicted;
}

/**
 * Start (or re-arm) the periodic idle sweep.
 *
 * Idempotent for identical parameters, but a CHANGED ttl/interval restarts the
 * timer. Without this, a user editing "Idle Release (minutes)" in the UI would
 * see no effect until the process restarted.
 */
export function startSessionBindingSweeper(ttlMs = DEFAULT_TTL_MS, intervalMs = DEFAULT_SWEEP_MS) {
  const nextTtl = ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS;
  const nextInterval = intervalMs > 0 ? intervalMs : DEFAULT_SWEEP_MS;
  if (sweepTimer && nextTtl === sweepTtlMs && nextInterval === sweepIntervalMs) return;

  sweepTtlMs = nextTtl;
  sweepIntervalMs = nextInterval;
  if (sweepTimer) clearInterval(sweepTimer);

  sweepTimer = setInterval(() => {
    try {
      sweepIdleBindings();
    } catch {
      /* never let the sweeper crash the process */
    }
  }, sweepIntervalMs);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

export function stopSessionBindingSweeper() {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/** Diagnostics snapshot. */
export function snapshotBindings() {
  const byConn = {};
  for (const [cid, set] of byConnection) byConn[cid] = set.size;
  return {
    totalSessions: bindings.size,
    connections: Object.keys(byConn).length,
    byConnection: byConn,
    capacity: MAX_BINDINGS,
    ttlMs: sweepTtlMs,
  };
}

/** Test helper. */
export function resetBindings() {
  bindings.clear();
  byConnection.clear();
}
