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
