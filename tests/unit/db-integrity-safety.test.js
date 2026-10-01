import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-integrity-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/db/adapters/betterSqliteAdapter.js");
  vi.doUnmock("@/lib/db/adapters/nodeSqliteAdapter.js");
  vi.doUnmock("@/lib/db/adapters/sqljsAdapter.js");
  vi.resetModules();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function createBackupSentinels(count = 5) {
  const root = path.join(tempDir, "db", "backups");
  fs.mkdirSync(root, { recursive: true });
  for (let i = 0; i < count; i += 1) {
    const dir = path.join(root, `backup-${i}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "sentinel.txt"), String(i));
    const timestamp = new Date(1_700_000_000_000 + i * 1_000);
    fs.utimesSync(dir, timestamp, timestamp);
  }
  return root;
}

describe("database startup integrity gate", () => {
  it("fails closed before schema mutation or backup pruning", async () => {
    const backupsDir = createBackupSentinels();
    const mutations = [];
    const adapter = {
      all(sql) {
        if (/PRAGMA\s+quick_check/i.test(sql)) {
          return [{ quick_check: "database disk image is malformed" }];
        }
        return [];
      },
      get() { return undefined; },
      exec(sql) {
        mutations.push(sql);
        throw new Error(`unexpected mutation: ${sql}`);
      },
      transaction(fn) { return fn(); },
      run() { throw new Error("unexpected mutation"); },
    };

    const { runMigrationOnce } = await import("@/lib/db/migrate.js");

    let failure;
    try {
      await runMigrationOnce(adapter);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: "DatabaseCorruptionError",
      code: "SQLITE_CORRUPT",
    });
    expect(failure.message).toContain("Startup stopped before schema migration or backup pruning");
    expect(failure.message).toContain("No backup was restored automatically");
    expect(mutations).toEqual([]);
    expect(fs.readdirSync(backupsDir).sort()).toEqual([
      "backup-0", "backup-1", "backup-2", "backup-3", "backup-4",
    ]);
  });

  it("does not fall through to another driver after corruption is reported", async () => {
    const dbDir = path.join(tempDir, "db");
    fs.mkdirSync(dbDir, { recursive: true });
    fs.writeFileSync(path.join(dbDir, "data.sqlite"), "damaged sqlite database");

    const nodeFactory = vi.fn();
    const sqlJsFactory = vi.fn();
    vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", () => ({
      createBetterSqliteAdapter() {
        const error = new Error("database disk image is malformed");
        error.code = "SQLITE_CORRUPT";
        throw error;
      },
    }));
    vi.doMock("@/lib/db/adapters/nodeSqliteAdapter.js", () => ({
      createNodeSqliteAdapter: nodeFactory,
    }));
    vi.doMock("@/lib/db/adapters/sqljsAdapter.js", () => ({
      createSqlJsAdapter: sqlJsFactory,
    }));

    const { getAdapter } = await import("@/lib/db/driver.js");

    await expect(getAdapter()).rejects.toMatchObject({
      name: "DatabaseCorruptionError",
      code: "SQLITE_CORRUPT",
    });
    expect(nodeFactory).not.toHaveBeenCalled();
    expect(sqlJsFactory).not.toHaveBeenCalled();
  });
});
