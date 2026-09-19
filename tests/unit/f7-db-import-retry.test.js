// F7 / T1.4 H-1 — an aborted legacy (db.json) import must be RETRIED on the next
// boot. Old code committed _meta.schemaVersion + backupSchemaVersion before the
// import, so isFreshDb() became false forever and the import never ran again
// (app silently empty). Fix design: an "importStatus" marker in _meta
// (null|pending|aborted|done|skipped-populated); only "done" (or the legacy
// marker file) suppresses import; retries are idempotent (import already runs
// inside adapter.transaction → rollback leaves no partial rows).
//
// Repro reference: /tmp/t14-reproAB.mjs (dup-id rows → row-count mismatch).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

function writeLegacy(obj) {
  fs.writeFileSync(path.join(tempDir, "db.json"), JSON.stringify(obj));
}
function metaGet(db, key) {
  const row = db.get(`SELECT value FROM _meta WHERE key = ?`, [key]);
  return row ? row.value : null;
}
function markerPath() {
  return path.join(tempDir, "db", ".migrated-from-json");
}

// Simulate a process restart against the SAME DATA_DIR.
async function boot() {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  return await import("@/lib/db/driver.js");
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "f7-import-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("H-1: retryable legacy JSON import", () => {
  it("BOOT1 aborts on row-count mismatch → BOOT2 with the SAME db.json imports (connections>0, no dup rows) → BOOT3 does not re-import", async () => {
    const now = new Date().toISOString();
    // Duplicate connection id → INSERT OR REPLACE dedupes → strict count 1 != 2 → MigrationAborted.
    writeLegacy({
      settings: { from: "legacy" },
      providerConnections: [
        { id: "dup1", provider: "openrouter", authType: "apikey", name: "A", createdAt: now, updatedAt: now },
        { id: "dup1", provider: "openrouter", authType: "apikey", name: "B", createdAt: now, updatedAt: now },
      ],
    });

    // BOOT1 — import aborts, transaction rolls everything back, status is recorded.
    const d1 = await boot();
    const db1 = await d1.getAdapter();
    expect(db1.get(`SELECT COUNT(*) c FROM providerConnections`).c).toBe(0); // rollback, no partial rows
    expect(metaGet(db1, "importStatus")).toBe("aborted");
    expect(metaGet(db1, "importAbortReason") || "").toMatch(/row-count mismatch/i);
    expect(fs.existsSync(markerPath())).toBe(false);
    db1.close?.();

    // BOOT2 — SAME DATA_DIR, SAME db.json. Old code: fresh=false → import skipped forever
    // (connections stay 0 → this is the red assertion for H-1).
    const d2 = await boot();
    const db2 = await d2.getAdapter();
    const conns = db2.get(`SELECT COUNT(*) c FROM providerConnections`).c;
    expect(conns).toBeGreaterThan(0);
    // Idempotent retry: dup collapses to exactly 1 row (last-write-wins), NOT 2, and
    // the rolled-back BOOT1 rows did not accumulate.
    expect(conns).toBe(1);
    expect(db2.get(`SELECT name FROM providerConnections`).name).toBe("B");
    expect(db2.get(`SELECT COUNT(*) c FROM settings`).c).toBe(1);
    expect(metaGet(db2, "importStatus")).toBe("done");
    expect(metaGet(db2, "migratedAt")).toBeTruthy();
    expect(parseInt(metaGet(db2, "importAttempts"), 10)).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(path.join(tempDir, "db.json"))).toBe(true); // legacy JSON kept
    const migratedAt = metaGet(db2, "migratedAt");
    db2.close?.();

    // BOOT3 — must NOT re-import.
    const d3 = await boot();
    const db3 = await d3.getAdapter();
    expect(db3.get(`SELECT COUNT(*) c FROM providerConnections`).c).toBe(1);
    expect(metaGet(db3, "migratedAt")).toBe(migratedAt);
    expect(metaGet(db3, "importStatus")).toBe("done");
    db3.close?.();
  });

  it("DB frozen in the old H-1 state (_meta stamped, no importStatus, no marker, empty entity tables) self-heals on next boot without user action", async () => {
    // Simulate a pre-fix stuck DB: boot WITHOUT legacy JSON (this is what the old buggy
    // boot did: stamps schemaVersion/backupSchemaVersion, no import ever attempted),
    // plus user settings written by the running app.
    const d0 = await boot();
    const db0 = await d0.getAdapter();
    db0.run(`INSERT INTO settings(id, data) VALUES(1, ?)`, ['{"user":"keep-me"}']);
    expect(metaGet(db0, "importStatus")).toBe(null); // never recorded (pre-fix state)
    db0.close?.();

    // Legacy db.json still present on disk (the old bug: it was ignored forever).
    const now = new Date().toISOString();
    writeLegacy({
      settings: { user: "stale-legacy" },
      providerConnections: [
        { id: "c1", provider: "openrouter", authType: "apikey", name: "X", createdAt: now, updatedAt: now },
        { id: "c2", provider: "anthropic", authType: "oauth", name: "Y", createdAt: now, updatedAt: now },
      ],
    });

    const d1 = await boot();
    const db1 = await d1.getAdapter();
    // Retry/recovery happened: connections imported...
    expect(db1.get(`SELECT COUNT(*) c FROM providerConnections`).c).toBe(2);
    // ...but recovery mode must NOT clobber settings the user changed after the abort.
    expect(JSON.parse(db1.get(`SELECT data FROM settings WHERE id=1`).data)).toEqual({ user: "keep-me" });
    expect(metaGet(db1, "importStatus")).toBe("done");
    db1.close?.();
  });

  it("non-fresh DB that already has entity data and no import record is NOT re-imported (skipped-populated + explicit warning)", async () => {
    const d0 = await boot();
    const db0 = await d0.getAdapter();
    // Live data created after the DB stopped being fresh (old completed import whose
    // marker file got lost, or a stuck user who started adding connections manually).
    db0.run(
      `INSERT INTO providerConnections(id, provider, authType, data, createdAt, updatedAt) VALUES('live1','p','apikey','{}','2020-01-01','2020-01-01')`
    );
    db0.close?.();

    const now = new Date().toISOString();
    writeLegacy({ providerConnections: [{ id: "file1", provider: "q", authType: "apikey", name: "F", createdAt: now, updatedAt: now }] });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const d1 = await boot();
      const db1 = await d1.getAdapter();
      const rows = db1.all(`SELECT id FROM providerConnections`);
      expect(rows.map((r) => r.id)).toEqual(["live1"]); // file1 NOT resurrected
      expect(metaGet(db1, "importStatus")).toBe("skipped-populated");
      expect(fs.existsSync(markerPath())).toBe(false);
      const warned = warnSpy.mock.calls.flat().map(String).join(" ");
      expect(warned).toMatch(/WARNING/);
      expect(warned).toMatch(/legacy/i);
    } finally {
      warnSpy.mockRestore();
    }
    // Re-boot: still not imported (decision is stable, not a one-shot).
    const d2 = await boot();
    const db2 = await d2.getAdapter();
    expect(db2.get(`SELECT COUNT(*) c FROM providerConnections`).c).toBe(1);
    db2.close?.();
  });
});

// T1.4 L-4 (scope add-on): syncSchemaFromTables swallowed index-creation errors
// with an empty catch, and its ALTER COLUMN failure warning didn't name the
// constraint. Failures must log an explicit WARNING identifying the object —
// boot must still continue (visibility only, no new throw).
describe("L-4: schema auto-sync failures are loudly logged", () => {
  it("failing CREATE INDEX logs WARNING naming the index and does not throw", async () => {
    const { syncSchemaFromTables } = await import("@/lib/db/migrate.js");
    const fake = {
      exec: (sql) => {
        if (/idx_pc_priority ON providerConnections/.test(sql)) throw new Error("simulated index failure");
      },
      all: () => [], // no columns exist → exercises ALTER path too
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => syncSchemaFromTables(fake)).not.toThrow();
      const warned = warnSpy.mock.calls.flat().map(String).join(" ");
      expect(warned).toMatch(/WARNING/);
      expect(warned).toMatch(/idx_pc_priority/); // names the index
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("failing ALTER TABLE ADD COLUMN logs WARNING naming table.column", async () => {
    const { syncSchemaFromTables } = await import("@/lib/db/migrate.js");
    const fake = {
      exec: (sql) => {
        if (/ALTER TABLE providerConnections ADD COLUMN priority/.test(sql)) throw new Error("simulated column failure");
      },
      all: () => [],
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => syncSchemaFromTables(fake)).not.toThrow();
      const warned = warnSpy.mock.calls.flat().map(String).join(" ");
      expect(warned).toMatch(/WARNING/);
      expect(warned).toMatch(/providerConnections\.priority/);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
