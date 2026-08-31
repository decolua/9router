// Federation write-path stamping helpers (FED-002).
//
// Every write to a replicated config table must bump federation_version and
// set updated_at; deletes become tombstones (deleted=1) instead of hard
// DELETEs so the central's delta endpoint can propagate them to edges.
//
// Version semantics — CRITICAL for delta correctness:
//   federation_version = global watermark + 1 on EVERY write (insert, update,
//   delete). The watermark is max(federation_version) across the 7 physical
//   tables. Stamping to watermark+1 (rather than row version + 1) guarantees
//   every change is strictly newer than anything an edge has seen, so the
//   delta query `federation_version > since` (since = edge's last applied
//   watermark) delivers every change exactly once. Without this, a row whose
//   version lags the watermark (e.g. created at v1 while another table is at
//   v2) would produce a tombstone/update at v2 — NOT > the edge's watermark
//   v2 — and the change would be silently lost forever.
//
// The watermark query is a MAX over 7 small config tables — microseconds per
// write, acceptable for a config DB. Writes inside one transaction see each
// other's uncommitted versions (SQLite), so versions stay strictly increasing
// within a batch.
import { REPLICATE_TABLES_PHYSICAL } from "./constants.js";

export function nowIso() {
  return new Date().toISOString();
}

// Next monotonically increasing federation version: current global watermark
// + 1. See module comment for why this must be the watermark, not the row's
// own version.
export function nextFederationVersion(db) {
  let max = 0;
  for (const table of REPLICATE_TABLES_PHYSICAL) {
    const row = db.get(`SELECT MAX(federation_version) AS m FROM ${table}`);
    const v = row?.m ?? 0;
    if (v > max) max = v;
  }
  return max + 1;
}

// INSERT INTO t(cols) VALUES(?) — append the stamp columns to the column
// list and placeholders to the VALUES list. Params go AFTER the existing
// statement params.
export function stampInsert(db) {
  return {
    cols: ", federation_version, updated_at, deleted",
    placeholders: ", ?, ?, 0",
    params: [nextFederationVersion(db), nowIso()],
  };
}

// INSERT ... ON CONFLICT(id) DO UPDATE SET ... — the conflict branch must
// adopt the INSERT's computed version (excluded.federation_version), not
// reset to 1, and must RESURRECT the row (deleted = 0): an upsert on a
// tombstoned row is a fresh write, not a no-op. Splice into the SET clause.
export function stampUpsertConflict() {
  return ", federation_version = excluded.federation_version, updated_at = excluded.updated_at, deleted = 0";
}

// UPDATE t SET ... — append to the SET clause. Params go after the existing
// SET params, before any WHERE params.
export function stampUpdate(db) {
  return {
    set: ", federation_version = ?, updated_at = ?",
    params: [nextFederationVersion(db), nowIso()],
  };
}

// DELETE → tombstone: UPDATE t SET deleted = 1, federation_version = ?,
// updated_at = ? WHERE ...
export function stampDelete(db) {
  return {
    set: "deleted = 1, federation_version = ?, updated_at = ?",
    params: [nextFederationVersion(db), nowIso()],
  };
}

// SQL fragment for read paths: hide tombstoned rows from logical reads.
// Splice into WHERE clauses (repos that build WHERE arrays push it first).
export const NOT_DELETED = "(deleted = 0 OR deleted IS NULL)";
