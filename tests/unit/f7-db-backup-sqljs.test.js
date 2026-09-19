// F7 / T1.4 H-2 — backupDbLite is dead under sql.js (last-resort driver):
// ATTACH DATABASE writes to sql.js's Emscripten virtual FS (in practice it just
// throws "unable to open database"), so pre-schema safety backups are silently
// missing exactly on the most fragile driver, and migrate.js swallowed the
// failure with a warn-and-continue.
// Fix: for driver "sql.js" build the backup with a fresh in-memory sql.js DB,
// copy every non-excluded table (+ explicit indexes) and export the buffer to
// a real file. Backup failures must surface an explicit WARNING at the call
// site. Native ATTACH path is kept unchanged.
//
// Repro reference: /tmp/t14-reproCD.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

// Force the sql.js fallback (same pattern as unit/db-driver-chain.test.js).
async function bootSqlJs() {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
  vi.doMock("@/lib/db/adapters/nodeSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
  return await import("@/lib/db/driver.js");
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "f7-backup-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  // doMock registrations survive resetModules — clear them so the default
  // driver chain is real unless a test re-mocks it.
  vi.doUnmock("@/lib/db/adapters/betterSqliteAdapter.js");
  vi.doUnmock("@/lib/db/adapters/nodeSqliteAdapter.js");
  vi.doUnmock("@/lib/db/adapters/sqljsAdapter.js");
  vi.doUnmock("@/lib/db/backup.js");
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("H-2: backupDbLite under sql.js", () => {
  it("forced sql.js driver: .bak is a real, non-empty, re-openable SQLite file (native ATTACH path threw 'unable to open database')", async () => {
    const d = await bootSqlJs();
    const db = await d.getAdapter();
    expect(db.driver).toBe("sql.js");

    db.run(
      `INSERT INTO providerConnections(id, provider, authType, data, createdAt, updatedAt) VALUES('c1','p','apikey','{}','2020-01-01','2020-01-01')`
    );
    db.run(
      `INSERT INTO usageHistory(timestamp, provider, usageEventId) VALUES('2020-01-01','p','evt-1')`
    );
    db.run(
      `INSERT INTO requestDetails(id, timestamp, data) VALUES('r1','2020-01-01','{"big":"log"}')`
    );

    const backup = await import("@/lib/db/backup.js");
    const dir = backup.makeBackupDir("f7-sqljs");
    // Old code THROWS here under sql.js ("unable to open database") → red.
    const dest = await backup.backupDbLite(db, dir);

    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.statSync(dest).size).toBeGreaterThan(0);
    // The backup DB must not be an Emscripten-FS phantom: re-open with the
    // public adapter factory against the real path.
    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const bak = await createSqlJsAdapter(dest);
    try {
      expect(bak.get(`SELECT COUNT(*) c FROM providerConnections`).c).toBe(1);
      expect(bak.get(`SELECT id FROM providerConnections`).id).toBe("c1");
      expect(bak.get(`SELECT COUNT(*) c FROM usageHistory`).c).toBe(1);
      const tables = bak.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((r) => r.name);
      expect(tables).toContain("_meta");
      expect(tables).not.toContain("requestDetails"); // exclusion preserved
      // Explicit indexes (incl. migration-owned idx_uh_event) must survive the backup;
      // indexes of excluded tables must not be copied.
      const idx = bak.all(`SELECT name FROM sqlite_master WHERE type='index'`).map((r) => r.name);
      expect(idx).toContain("idx_uh_event");
      expect(idx).not.toContain("idx_rd_ts");
    } finally {
      bak.close?.();
    }
    db.close?.();
  });

  it("backup failure is not swallowed inside backupDbLite (rejects with the real cause)", async () => {
    const backup = await import("@/lib/db/backup.js");
    const dir = path.join(tempDir, "bk");
    fs.mkdirSync(dir, { recursive: true });
    const fake = {
      driver: "sql.js",
      all: () => {
        throw new Error("boom-fake-sqljs");
      },
    };
    await expect(backup.backupDbLite(fake, dir)).rejects.toThrow(/boom-fake-sqljs/);
  });

  it("migrate.js logs an explicit WARNING (not a swallowed error) when the pre-schema backup fails, and boot continues", async () => {
    // First boot: real DB. Then roll backupSchemaVersion back to force the
    // pre-schema backup branch on the next boot, with a backup module whose
    // backupDbLite always fails.
    const d0 = await import("@/lib/db/driver.js");
    const db0 = await d0.getAdapter();
    db0.run(`UPDATE _meta SET value = '0' WHERE key = 'backupSchemaVersion'`);
    db0.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    vi.doMock("@/lib/db/backup.js", async (importOriginal) => {
      const orig = await importOriginal();
      return { ...orig, backupDbLite: async () => { throw new Error("simulated backup failure"); } };
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const d1 = await import("@/lib/db/driver.js");
      const db1 = await d1.getAdapter(); // boot must continue (catch-and-continue preserved)
      const warned = warnSpy.mock.calls.flat().map(String).join(" ");
      expect(warned).toMatch(/WARNING/); // old code: only "pre-schema backup failed (continuing)"
      expect(warned).toMatch(/simulated backup failure/);
      expect(db1).toBeTruthy();
      db1.close?.();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("native driver ATTACH path still produces a valid backup (regression guard)", async () => {
    const d = await import("@/lib/db/driver.js");
    const db = await d.getAdapter();
    if (db.driver === "sql.js") return; // native-only assertion (fallback env)
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, data, createdAt, updatedAt) VALUES('n1','p','apikey','{}','2020-01-01','2020-01-01')`
    );
    const backup = await import("@/lib/db/backup.js");
    const dir = backup.makeBackupDir("f7-native");
    const dest = await backup.backupDbLite(db, dir);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.statSync(dest).size).toBeGreaterThan(0);
    db.close?.();
  });
});
