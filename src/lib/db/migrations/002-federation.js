// Federation schema (FED-001) — version 2.
//
// Stamps the 7 PHYSICAL config tables (settings, providerConnections,
// providerNodes, proxyPools, apiKeys, combos, kv) with replication columns
// and creates the federation bookkeeping tables. The spec's 8 LOGICAL tables
// include modelAliases + pricing, which are kv rows (scope='modelAliases' /
// scope='pricing') — kv is the physical table stamped for those.
//
// Idempotency: up(db) MUST be re-apply safe on every SQLite adapter
// (bun:sqlite, better-sqlite3, node:sqlite, sql.js). ALTER TABLE ADD COLUMN
// fails when the column already exists, so every ADD is guarded by a
// PRAGMA table_info check (adapter.all works on all 4 backends). New tables
// use CREATE TABLE IF NOT EXISTS; the federation_meta seed row uses
// INSERT OR IGNORE.
import { REPLICATE_TABLES_PHYSICAL } from "../../federation/constants.js";

const FED_COLUMNS = [
  ["federation_version", "INTEGER NOT NULL DEFAULT 0"],
  ["updated_at", "TEXT"],
  ["deleted", "INTEGER NOT NULL DEFAULT 0"],
];

function ensureColumn(db, table, column, def) {
  // Skip entirely if the table doesn't exist (e.g. bare adapter, or a table
  // dropped out-of-band) — the migration runner always applies 001 first, but
  // a throw here would roll back the whole chain and block boot.
  const exists = db.get(`SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name = ?`, [table]);
  if (!exists) return;
  const existing = db.all(`PRAGMA table_info(${table})`);
  if (existing.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}

export default {
  version: 2,
  name: "federation",
  up(db) {
    // 1. Replication columns on the 7 physical config tables (guarded ADD).
    for (const table of REPLICATE_TABLES_PHYSICAL) {
      for (const [column, def] of FED_COLUMNS) {
        ensureColumn(db, table, column, def);
      }
    }

    // 2. federation_meta — single-row (id=1, settings pattern) federation state.
    db.exec(`
      CREATE TABLE IF NOT EXISTS federation_meta (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        role TEXT,
        edgeId TEXT,
        lastAppliedRevision INTEGER,
        schemaVersion INTEGER,
        leaseOwner TEXT,
        leaseExpiry TEXT
      )
    `);
    // Seed the single row so FED-002+ can read/write it unconditionally.
    db.run(`INSERT OR IGNORE INTO federation_meta(id) VALUES(1)`);

    // 3. pendingWrites — edge-only write queue (FED-004 builds the repo
    //    logic). idempotency_key is the PK; method/path/body are carried in
    //    payload JSON per the FED-001 design (grok-4.5 analysis).
    db.exec(`
      CREATE TABLE IF NOT EXISTS pendingWrites (
        idempotency_key TEXT PRIMARY KEY,
        payload TEXT,
        state TEXT,
        created_at TEXT,
        attempts INTEGER DEFAULT 0
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_pw_state ON pendingWrites(state)`);
  },
};
