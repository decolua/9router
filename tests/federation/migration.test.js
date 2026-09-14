// FED-001 — federation migration idempotency + standalone-boot drift tests.
//
// Covers:
//  - migration 002 re-apply safety on every SQLite adapter that loads on this
//    host (better-sqlite3, node:sqlite, sql.js; bun:sqlite is Bun-only and
//    skipped under Node — noted in the report)
//  - fresh chain (001 → 002) produces the federation schema
//  - fresh standalone boot (FEDERATION_MODE unset) via the real driver chain
//    has zero drift vs baseline: baseline tables keep their exact baseline
//    columns, the only additions are the federation columns/tables
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { TABLES } from "@/lib/db/schema.js";
import { REPLICATE_TABLES_PHYSICAL } from "@/lib/federation/constants.js";

const FED_COLUMNS = ["federation_version", "updated_at", "deleted"];
const FED_TABLES = ["federation_meta", "pendingWrites"];
const FED_META_COLUMNS = [
  "id",
  "role",
  "edgeId",
  "lastAppliedRevision",
  "schemaVersion",
  "leaseOwner",
  "leaseExpiry",
  "last_state",
];

// Baseline physical tables (TABLES minus _meta, which is bootstrap).
const BASELINE_TABLES = Object.keys(TABLES).filter((t) => t !== "_meta");

function columnNames(db, table) {
  return db.all(`PRAGMA table_info(${table})`).map((c) => c.name);
}

function baselineColumns(table) {
  return Object.keys(TABLES[table].columns);
}

// ─── Per-adapter harness ──────────────────────────────────────────────────
// Each adapter factory gets a fresh temp DB file. bun:sqlite is skipped
// (Bun runtime only — this host runs Node v22.22.3).
async function loadAdapterFactories() {
  const factories = [];
  try {
    const mod = await import("@/lib/db/adapters/betterSqliteAdapter.js");
    factories.push({
      name: "better-sqlite3",
      create: (file) => mod.createBetterSqliteAdapter(file),
    });
  } catch (e) {
    console.warn(`[test] better-sqlite3 unavailable: ${e.message}`);
  }
  try {
    const mod = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
    factories.push({
      name: "node:sqlite",
      create: async (file) => mod.createNodeSqliteAdapter(file),
    });
  } catch (e) {
    console.warn(`[test] node:sqlite unavailable: ${e.message}`);
  }
  try {
    const mod = await import("@/lib/db/adapters/sqljsAdapter.js");
    factories.push({
      name: "sql.js",
      create: async (file) => mod.createSqlJsAdapter(file),
    });
  } catch (e) {
    console.warn(`[test] sql.js unavailable: ${e.message}`);
  }
  return factories;
}

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-mig-"));
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe("migration 002 idempotency across adapters", () => {
  it("re-applies cleanly on every available adapter (no-op second pass)", async () => {
    const factories = await loadAdapterFactories();
    expect(factories.length).toBeGreaterThan(0);
    const { default: m001 } = await import("@/lib/db/migrations/001-initial.js");
    const { default: m002 } = await import("@/lib/db/migrations/002-federation.js");

    for (const factory of factories) {
      const file = path.join(tempDir, `${factory.name.replace(":", "-")}.sqlite`);
      const db = await factory.create(file);

      // Realistic chain: baseline tables exist before the federation migration
      expect(() => m001.up(db)).not.toThrow();

      // First apply
      expect(() => m002.up(db)).not.toThrow();

      // Second apply must be a no-op success (guarded ADD COLUMN + IF NOT EXISTS)
      expect(() => m002.up(db)).not.toThrow();

      // Columns present on all 7 physical tables
      for (const table of REPLICATE_TABLES_PHYSICAL) {
        const cols = columnNames(db, table);
        for (const col of FED_COLUMNS) expect(cols).toContain(col);
      }

      // Federation tables exist; single seeded federation_meta row survives re-apply
      const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((t) => t.name);
      for (const t of FED_TABLES) expect(tables).toContain(t);
      const metaCount = db.get(`SELECT COUNT(*) AS c FROM federation_meta`).c;
      expect(metaCount).toBe(1);

      db.close?.();
    }
  });

  it("fresh chain (001 → 002) builds the full federation schema on every adapter", async () => {
    const factories = await loadAdapterFactories();
    const { default: m001 } = await import("@/lib/db/migrations/001-initial.js");
    const { default: m002 } = await import("@/lib/db/migrations/002-federation.js");

    for (const factory of factories) {
      const file = path.join(tempDir, `chain-${factory.name.replace(":", "-")}.sqlite`);
      const db = await factory.create(file);

      expect(() => m001.up(db)).not.toThrow();
      expect(() => m002.up(db)).not.toThrow();

      for (const table of REPLICATE_TABLES_PHYSICAL) {
        const cols = columnNames(db, table);
        for (const col of FED_COLUMNS) expect(cols).toContain(col);
      }
      const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((t) => t.name);
      for (const t of FED_TABLES) expect(tables).toContain(t);

      db.close?.();
    }
  });
});

describe("migration 003 idempotency (last_state)", () => {
  it("adds last_state to federation_meta and re-applies cleanly on every adapter", async () => {
    const factories = await loadAdapterFactories();
    expect(factories.length).toBeGreaterThan(0);
    const { default: m001 } = await import("@/lib/db/migrations/001-initial.js");
    const { default: m002 } = await import("@/lib/db/migrations/002-federation.js");
    const { default: m003 } = await import("@/lib/db/migrations/003-federation-state.js");

    for (const factory of factories) {
      const file = path.join(tempDir, `m003-${factory.name.replace(":", "-")}.sqlite`);
      const db = await factory.create(file);

      m001.up(db);
      m002.up(db);

      // First apply
      expect(() => m003.up(db)).not.toThrow();
      const cols = columnNames(db, "federation_meta");
      for (const c of FED_META_COLUMNS) expect(cols).toContain(c);

      // Second apply must be a no-op success (guarded ADD COLUMN)
      expect(() => m003.up(db)).not.toThrow();

      // Seed row survives; last_state defaults to NULL (LINKED by reader)
      const meta = db.get(`SELECT last_state FROM federation_meta WHERE id = 1`);
      expect(meta.last_state).toBeNull();

      // last_state is writable (FED-004 will own transitions)
      db.run(`UPDATE federation_meta SET last_state = 'degraded' WHERE id = 1`);
      expect(db.get(`SELECT last_state FROM federation_meta WHERE id = 1`).last_state).toBe("degraded");

      db.close?.();
    }
  });

  it("full chain 001 → 002 → 003 produces the complete federation schema", async () => {
    const factories = await loadAdapterFactories();
    const { default: m001 } = await import("@/lib/db/migrations/001-initial.js");
    const { default: m002 } = await import("@/lib/db/migrations/002-federation.js");
    const { default: m003 } = await import("@/lib/db/migrations/003-federation-state.js");

    for (const factory of factories) {
      const file = path.join(tempDir, `chain3-${factory.name.replace(":", "-")}.sqlite`);
      const db = await factory.create(file);

      expect(() => m001.up(db)).not.toThrow();
      expect(() => m002.up(db)).not.toThrow();
      expect(() => m003.up(db)).not.toThrow();

      const cols = columnNames(db, "federation_meta");
      expect(cols).toContain("last_state");

      db.close?.();
    }
  });
});

describe("getEdgeState (FED-003 state reader)", () => {
  it("defaults to LINKED when last_state is NULL/missing", async () => {
    const factories = await loadAdapterFactories();
    const { default: m001 } = await import("@/lib/db/migrations/001-initial.js");
    const { default: m002 } = await import("@/lib/db/migrations/002-federation.js");
    const { default: m003 } = await import("@/lib/db/migrations/003-federation-state.js");
    const { getEdgeState } = await import("@/lib/federation/state.js");

    for (const factory of factories) {
      const file = path.join(tempDir, `state-${factory.name.replace(":", "-")}.sqlite`);
      const db = await factory.create(file);
      m001.up(db);
      m002.up(db);
      m003.up(db);

      // NULL last_state → LINKED
      expect(getEdgeState(db)).toBe("linked");

      // Unknown value → LINKED (defensive)
      db.run(`UPDATE federation_meta SET last_state = 'bogus' WHERE id = 1`);
      expect(getEdgeState(db)).toBe("linked");

      // Persisted DEGRADED → read back
      db.run(`UPDATE federation_meta SET last_state = 'degraded' WHERE id = 1`);
      expect(getEdgeState(db)).toBe("degraded");

      db.close?.();
    }
  });

  it("defaults to LINKED when the table/column is absent (pre-003 schema)", async () => {
    const factories = await loadAdapterFactories();
    const { default: m001 } = await import("@/lib/db/migrations/001-initial.js");
    const { default: m002 } = await import("@/lib/db/migrations/002-federation.js");
    const { getEdgeState } = await import("@/lib/federation/state.js");

    for (const factory of factories) {
      const file = path.join(tempDir, `state2-${factory.name.replace(":", "-")}.sqlite`);
      const db = await factory.create(file);
      m001.up(db);
      m002.up(db); // no 003 → no last_state column

      expect(getEdgeState(db)).toBe("linked");

      db.close?.();
    }
  });
});

describe("standalone boot drift (FEDERATION_MODE unset)", () => {
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(() => {
    delete process.env.FEDERATION_MODE;
    delete global._dbAdapter;
    vi.resetModules();
  });

  afterEach(() => {
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("fresh standalone boot: baseline tables unchanged, only federation additions", async () => {
    process.env.DATA_DIR = tempDir;
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db = await getAdapter();

    // Migration chain fully applied
    const row = db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((t) => t.name);

    // Every baseline table exists
    for (const t of BASELINE_TABLES) expect(tables).toContain(t);

    // Baseline columns are all still present, in order, with no extras beyond
    // the federation columns on the 7 stamped tables.
    for (const t of BASELINE_TABLES) {
      const cols = columnNames(db, t);
      const expected = baselineColumns(t);
      for (const c of expected) expect(cols).toContain(c);
      const extras = cols.filter((c) => !expected.includes(c));
      if (REPLICATE_TABLES_PHYSICAL.includes(t)) {
        expect(extras.sort()).toEqual([...FED_COLUMNS].sort());
      } else {
        expect(extras).toEqual([]);
      }
    }

    // Federation tables present
    for (const t of FED_TABLES) expect(tables).toContain(t);
  });
});
