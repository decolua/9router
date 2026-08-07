// Federation edge state reader (FED-003).
//
// Reads the edge's persisted failover state from federation_meta.last_state
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
