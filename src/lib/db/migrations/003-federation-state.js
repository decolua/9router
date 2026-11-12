// Federation edge state column (FED-003) — version 3.
//
// Adds federation_meta.last_state (LINKED/DEGRADED/RECOVERING, spec §3.4).
// FED-004 owns state transitions; FED-003 only reads the column so the
// edge proxy can fall through to local handlers when DEGRADED.
//
// Idempotency: guarded PRAGMA table_info ADD COLUMN (same pattern as 002)
// so re-apply is safe on every SQLite adapter (bun:sqlite, better-sqlite3,
// node:sqlite, sql.js).
export default {
  version: 3,
  name: "federation-state",
  up(db) {
    const existing = db.all(`PRAGMA table_info(federation_meta)`);
    if (existing.some((c) => c.name === "last_state")) return;
    db.exec(`ALTER TABLE federation_meta ADD COLUMN last_state TEXT`);
  },
};
