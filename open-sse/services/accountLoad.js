/**
 * Account Load Registry — per-account in-flight request accounting.
 *
 * Purpose: when several concurrent client requests are routed to the SAME upstream
 * account (a very likely outcome right after switching fill-first → session binding),
 * the account can be saturated and start returning 429s. This module tracks how many
 * requests are currently in flight per connection so the selector can:
 *
 *   - skip an account that is already at its per-account concurrency ceiling;
 *   - prefer the least-loaded account when several are equally valid;
 *   - report load so the caller can log / expose it.
 *
 * The registry is in-process and intentionally tiny: a Map<connectionId, count>.
 * It is NOT authoritative across processes — a multi-process deployment should move
 * this to a shared store later. `acquire`/`release` are pure synchronous Map ops so
 * that they can be called INSIDE the selection mutex without introducing awaits
 * (an await inside the mutex would reopen the TOCTOU window we are closing).
 */

const load = new Map(); // connectionId -> { pending: number[] } (acquisition timestamps)

/** Default ceiling when the caller does not specify one (0 / null = unlimited). */
export const DEFAULT_MAX_CONCURRENT_PER_ACCOUNT = 0;

/**
 * Safety valve. A slot is reserved by the selector and released by the caller's
 * finally-block; if a caller is ever killed between those two points (process
 * signal, unhandled rejection in a detached task, a future refactor that forgets
 * the finally), the count would stay elevated forever and that account would look
 * permanently saturated — turning one lost request into a persistent outage for
 * that account.
 *
 * Tracking the acquisition TIMESTAMP of each outstanding slot lets us reclaim any
 * slot older than a plausible upper bound on request duration. 10 minutes is well
 * beyond even long streaming responses, so this never steals a live slot.
 */
const STALE_SLOT_MS = 10 * 60 * 1000;

/** Drop timestamps older than STALE_SLOT_MS. Returns the surviving array. */
function prune(pending, now) {
  if (pending.length === 0) return pending;
  const cutoff = now - STALE_SLOT_MS;
  let firstLive = 0;
  while (firstLive < pending.length && pending[firstLive] < cutoff) firstLive += 1;
  return firstLive === 0 ? pending : pending.slice(firstLive);
}

/**
 * Atomically reserve one in-flight slot on `connectionId`.
 *
 * @param {string} connectionId
 * @param {number} max - ceiling to enforce; <= 0 means unlimited
 * @returns {{ ok: boolean, count: number, max: number }}
 *          ok=false when the account is already at the ceiling (caller must pick
 *          another account); count is the load BEFORE this acquire on failure and
 *          AFTER it on success.
 */
export function acquire(connectionId, max = DEFAULT_MAX_CONCURRENT_PER_ACCOUNT) {
  if (!connectionId || connectionId === "noauth") {
    // Virtual / stateless accounts have no meaningful ceiling.
    return { ok: true, count: 0, max: 0 };
  }
  const now = Date.now();
  const entry = load.get(connectionId) || { pending: [] };
  // Timestamps are appended in order, so they are already sorted ascending.
  entry.pending = prune(entry.pending, now);

  const ceiling = Number(max) > 0 ? Number(max) : 0;
  if (ceiling > 0 && entry.pending.length >= ceiling) {
    load.set(connectionId, entry);
    return { ok: false, count: entry.pending.length, max: ceiling };
  }
  entry.pending.push(now);
  load.set(connectionId, entry);
  return { ok: true, count: entry.pending.length, max: ceiling };
}

/**
 * Release a previously acquired slot. Idempotent by contract only when balanced;
 * an accidental double release cannot drive the count negative (and thus cannot
 * permanently blacklist an account), because we simply drop the oldest
 * outstanding timestamp and clamp at empty.
 */
export function release(connectionId) {
  if (!connectionId || connectionId === "noauth") return 0;
  const entry = load.get(connectionId);
  if (!entry) return 0;
  entry.pending.shift();
  if (entry.pending.length === 0) {
    // Drop empty entries so the Map does not grow without bound.
    load.delete(connectionId);
    return 0;
  }
  load.set(connectionId, entry);
  return entry.pending.length;
}

/** Current in-flight count for a connection (0 when unknown). */
export function getLoad(connectionId) {
  if (!connectionId) return 0;
  const entry = load.get(connectionId);
  if (!entry) return 0;
  // Prune on read too, so a stale slot cannot make an account look busy to the
  // least-loaded comparison even before the next acquire() on it.
  entry.pending = prune(entry.pending, Date.now());
  if (entry.pending.length === 0) {
    load.delete(connectionId);
    return 0;
  }
  return entry.pending.length;
}

/** Snapshot of all non-zero loads (for logging / diagnostics). */
export function snapshotLoad() {
  const out = {};
  const now = Date.now();
  for (const [id, entry] of load) {
    entry.pending = prune(entry.pending, now);
    if (entry.pending.length > 0) out[id] = entry.pending.length;
  }
  return out;
}

/** Clear all accounting (test helper / explicit reset). */
export function resetLoad() {
  load.clear();
}

/**
 * Release slots for a connection that is being frozen / removed, and return how
 * many were dropped. Used by the session-binding layer so that moving a binding
 * away from an account cannot leave a permanent phantom load behind.
 */
export function drainLoad(connectionId) {
  const entry = load.get(connectionId);
  if (!entry) return 0;
  load.delete(connectionId);
  return entry.pending.length;
}
