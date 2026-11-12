// Federation fencing + queue error columns (FED-004) — version 4.
//
// Adds the pieces the failover state machine and write queue need:
//   - federation_meta.fencing_token: the lease token central issues on each
//     /api/federation/verify heartbeat. The edge stores the last token it
//     saw and sends it with replay requests; central rejects stale tokens
//     with 409 (spec §3.3 "stale-fenced replays rejected 409").
//   - pendingWrites.last_error: surfaced by FED-005 diagnostics; keeps the
//     queue's error state out of the payload JSON.
//   - replayLog: central-side idempotency ledger. A replay whose
//     idempotency_key was already applied is a 200 no-op (never double-apply
//     — the idempotency contract of the replay path).
//
// Idempotency: guarded PRAGMA table_info ADD COLUMN (same pattern as 002/003)
// so re-apply is safe on every SQLite adapter (bun:sqlite, better-sqlite3,
// node:sqlite, sql.js).
export default {
  version: 4,
  name: "federation-fencing",
  up(db) {
    const metaCols = db.all(`PRAGMA table_info(federation_meta)`);
    if (!metaCols.some((c) => c.name === "fencing_token")) {
      db.exec(`ALTER TABLE federation_meta ADD COLUMN fencing_token TEXT`);
    }

    const pwCols = db.all(`PRAGMA table_info(pendingWrites)`);
    if (!pwCols.some((c) => c.name === "last_error")) {
      db.exec(`ALTER TABLE pendingWrites ADD COLUMN last_error TEXT`);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS replayLog (
        idempotency_key TEXT PRIMARY KEY,
        applied_at TEXT,
        method TEXT,
        path TEXT
      )
    `);
  },
};
