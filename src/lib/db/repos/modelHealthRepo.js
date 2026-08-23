import { getAdapter } from "../driver.js";

// Durable routing health: how often each combo member answered, and how often
// it failed, bucketed by hour.
//
// The tuner reads this to decide combo order. That makes it load-bearing, not
// diagnostic, and it is deliberately NOT behind the observability toggle that
// gates requestDetails — a debug flag must not be able to blind the router.
// See the note on TABLES.modelHealth in ../schema.js for why requestDetails
// could not serve this purpose.

/** Buckets older than this are dropped. Comfortably wider than the tuner's
 *  1-day scoring window, so pruning can never eat live signal. */
export const RETENTION_DAYS = 7;

/** Prune at most this often; the sweep is cheap but pointless to run per event. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

let lastPruneAt = 0;

/** Hour bucket key: "2026-08-23T15". Sorts lexically, which is what the
 *  window and retention comparisons rely on. */
export function hourBucket(at = Date.now()) {
  return new Date(at).toISOString().slice(0, 13);
}

function pruneIfDue(db, now) {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  const cutoff = hourBucket(now - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  db.run(`DELETE FROM modelHealth WHERE bucket < ?`, [cutoff]);
}

/**
 * Record one attempt against one routed model id.
 *
 * Writes straight through rather than buffering. The row is two integers in a
 * table that holds at most (models × 24 × RETENTION_DAYS) rows, so the upsert
 * is far cheaper than the request that produced it — and buffering would risk
 * losing exactly the failures this table exists to remember.
 *
 * @param {string} modelId routed id as combos store it, e.g. "bb/gpt-5.5"
 * @param {"ok"|"err"} outcome
 */
export async function recordModelOutcome(modelId, outcome, at = Date.now()) {
  if (!modelId) return;
  const isOk = outcome === "ok";
  const db = await getAdapter();
  const bucket = hourBucket(at);
  const stamp = new Date(at).toISOString();
  db.run(
    `INSERT INTO modelHealth(modelId, bucket, ok, err, lastOkAt, lastErrAt) VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(modelId, bucket) DO UPDATE SET
       ok = ok + excluded.ok,
       err = err + excluded.err,
       lastOkAt = COALESCE(excluded.lastOkAt, lastOkAt),
       lastErrAt = COALESCE(excluded.lastErrAt, lastErrAt)`,
    [modelId, bucket, isOk ? 1 : 0, isOk ? 0 : 1, isOk ? stamp : null, isOk ? null : stamp]
  );
  pruneIfDue(db, at);
}

/**
 * Aggregated health over a trailing window, keyed by routed model id.
 * @returns {Promise<Array<{modelId: string, ok: number, err: number, lastOkAt: string|null, lastErrAt: string|null}>>}
 */
export async function getModelHealthWindow(windowHours = 24, at = Date.now()) {
  const db = await getAdapter();
  const since = hourBucket(at - windowHours * 60 * 60 * 1000);
  return db.all(
    `SELECT modelId, SUM(ok) ok, SUM(err) err, MAX(lastOkAt) lastOkAt, MAX(lastErrAt) lastErrAt
       FROM modelHealth WHERE bucket >= ? GROUP BY modelId`,
    [since]
  );
}

export async function clearModelHealthRows() {
  const db = await getAdapter();
  db.run(`DELETE FROM modelHealth`);
  lastPruneAt = 0;
}
