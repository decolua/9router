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
