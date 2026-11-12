// Federation edge state reader/writer (FED-003 read, FED-004 write).
//
// Reads/writes the edge's persisted failover state in federation_meta.last_state
// (spec §3.4: LINKED → DEGRADED → RECOVERING → LINKED). FED-004 owns the
// state machine and writes last_state; FED-003 only READS it so the edge
// proxy knows when to fall through to local handlers.
//
// Default: LINKED when the column/row is missing or the value is unknown —
// LINKED is the resting state of an edge (proxy-up-by-default), so a fresh
// or unreadable DB must not disable proxying.
import { STATES, STATES_LIST } from "./constants.js";

export function getEdgeState(db) {
  try {
    const row = db.get(`SELECT last_state FROM federation_meta WHERE id = 1`);
    const s = row?.last_state;
    if (s && STATES_LIST.includes(s)) return s;
    return STATES.LINKED;
  } catch {
    // Missing table/column (pre-003 schema) or adapter error → LINKED.
    return STATES.LINKED;
  }
}

// ─── Replica readiness (DF-9ROUTER-31) ───────────────────────────────────
//
// `fresh` is the condition an edge reaches when it has a replica worth
// serving reads from. It is evaluated in two places that MUST agree:
//   - failover.js's DEGRADED flip (the state machine, unchanged) — after the
//     flip the edge serves /v1 from the replica;
//   - proxy.js's pre-DEGRADED window decision — an upstream failure while
//     still LINKED (the heartbeat failure span has not reached the jittered
//     outage threshold yet) may be served from the replica instead of
//     answering a hard 502 FED_UPSTREAM_ERROR (DF-9ROUTER-31: the window
//     answered fail-hard where fail-open is safe).
//
// This is NOT a new state: nothing here writes last_state. The machine still
// owns the LINKED → DEGRADED transition; this only answers "is the local
// data already good enough to answer from", one step earlier.
//
// Semantics mirror server.js buildLocalStatusPayload (FED-016/FED-021):
//   initialized        role/last_state/lastAppliedRevision all NULL = the
//                      runtime never ran (migration 002 seeds an all-NULL
//                      row) → there is no replica to serve
//   centralMaxVersion  the watermark central last advertised. NULL = no batch
//                      was EVER applied → no baseline → lag is UNKNOWN, not
//                      zero (a never-synced edge must not read as fresh)
//   revisionLag        max(0, centralMaxVersion - lastAppliedRevision)
//   fresh              initialized && centralMaxVersion != null && lag == 0
//
// Pure over a federation_meta row so the same numbers drive the status
// payload and the serving decision (no drift between what the operator sees
// and what the proxy acts on).
export function computeReplicaFreshness(meta) {
  const out = {
    initialized: false,
    lastAppliedRevision: null,
    centralMaxVersion: null,
    revisionLag: 0,
    fresh: false,
  };
  if (!meta) return out;
  out.initialized = meta.role != null || meta.last_state != null || meta.lastAppliedRevision != null;
  out.lastAppliedRevision = meta.lastAppliedRevision ?? null;
  out.centralMaxVersion = meta.centralMaxVersion == null ? null : Number(meta.centralMaxVersion);
  out.revisionLag = Math.max(0, (out.centralMaxVersion ?? 0) - (out.lastAppliedRevision ?? 0));
  out.fresh =
    out.initialized && out.centralMaxVersion != null && out.lastAppliedRevision != null && out.revisionLag === 0;
  return out;
}

// Read the freshness straight from federation_meta. Never throws — a missing
// table/column (pre-003 schema) or a dead adapter answers "not fresh", which
// keeps the caller on the fail-hard path it had before DF-9ROUTER-31.
export function readReplicaFreshness(db) {
  if (!db) return computeReplicaFreshness(null);
  let meta = null;
  try {
    meta = db.get(
      `SELECT role, last_state, lastAppliedRevision, centralMaxVersion FROM federation_meta WHERE id = 1`
    );
  } catch {
    return computeReplicaFreshness(null);
  }
  return computeReplicaFreshness(meta);
}

// True when serving a read from the local replica is safe: the replica is
// initialized AND fully caught up. Used by proxy.js's pre-DEGRADED window
// decision.
export function canServeFromReplica(db) {
  return readReplicaFreshness(db).fresh;
}

// Persist a failover state transition (FED-004). Validates against
// STATES_LIST; idempotent (writing the current state is a no-op UPDATE).
// Never throws on a missing table/column (pre-003 schema) — logs a warning
// and returns false so a degraded deployment degrades to a warning rather
// than crashing the process. Returns true when the write landed.
export function setEdgeState(db, state) {
  if (!STATES_LIST.includes(state)) {
    throw new Error(`[federation] invalid edge state '${state}' (expected one of: ${STATES_LIST.join(", ")})`);
  }
  try {
    const res = db.run(
      `INSERT INTO federation_meta(id, last_state) VALUES(1, ?)
       ON CONFLICT(id) DO UPDATE SET last_state = excluded.last_state`,
      [state]
    );
    return true;
  } catch (err) {
    console.warn(`[federation] setEdgeState('${state}') failed (federation_meta unavailable?): ${err?.message || err}`);
    return false;
  }
}
