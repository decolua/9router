// F7 / T1.4 H-3 + L-2 — driver.js init lifecycle.
// H-3: `state.initPromise = initAdapter().then(...)` froze the FIRST rejection
// (e.g. transient failure: corrupt/locked data.sqlite, transient mkdir or
// migration error) forever: every later getAdapter() rejected even after the
// operator repaired the cause. closeAdapter() only cleared state.instance,
// never initPromise.
// L-2: closeAdapter() during an in-flight init left a double-init window: the
// stale .then still published state.instance (orphan handle + timers leaking)
// and a second init opened a second adapter over the same file (last-writer
// wins).
// Fix: rejection clears initPromise; a generation counter invalidates in-flight
// inits on close (the orphan adapter is closed, not published); initAdapter
// closes an adapter it opened before a later step (migrations) failed.
//
// Repro reference: /tmp/t14-reproD2.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "f7-driver-"));
  process.env.DATA_DIR = tempDir;
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  // doMock registrations survive resetModules — start each test unmocked.
  vi.doUnmock("@/lib/db/adapters/betterSqliteAdapter.js");
  vi.doUnmock("@/lib/db/adapters/nodeSqliteAdapter.js");
  vi.doUnmock("@/lib/db/adapters/sqljsAdapter.js");
  vi.doUnmock("@/lib/db/migrate.js");
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

// Wrap the sql.js adapter factory so the test can observe created/closed adapters.
function trackSqlJsAdapters(created) {
  vi.doMock("@/lib/db/adapters/sqljsAdapter.js", async (importOriginal) => {
    const orig = await importOriginal();
    return {
      ...orig,
      createSqlJsAdapter: async (p) => {
        const a = await orig.createSqlJsAdapter(p);
        const rec = { closed: false, driver: a.driver };
        created.push(rec);
        return { ...a, close: () => { rec.closed = true; return a.close(); } };
      },
    };
  });
}

function forceSqlJs() {
  vi.doMock("@/lib/db/adapters/betterSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
  vi.doMock("@/lib/db/adapters/nodeSqliteAdapter.js", () => {
    throw new Error("simulated unavailable");
  });
}

describe("H-3: transient init failure must not poison getAdapter()", () => {
  it("init fails once (corrupt data.sqlite → all drivers reject) → operator repairs → getAdapter resolves WITHOUT process restart", async () => {
    // Same repro as /tmp/t14-reproD2.mjs: garbage bytes in the DB file make every
    // driver fail on first open.
    fs.mkdirSync(path.join(tempDir, "db"), { recursive: true });
    const df = path.join(tempDir, "db", "data.sqlite");
    fs.writeFileSync(df, "garbage-not-a-sqlite-file");

    const d = await import("@/lib/db/driver.js");
    await expect(d.getAdapter()).rejects.toThrow(/No SQLite driver available/);

    // Operator repairs the DB file. Old code: initPromise was frozen on the first
    // rejection → this call rejects with the SAME error forever → RED.
    fs.rmSync(df);
    const db = await d.getAdapter();
    expect(db).toBeTruthy();
    expect(["bun:sqlite", "better-sqlite3", "node:sqlite", "sql.js"]).toContain(db.driver);
    // Fully functional: migrations ran on the fresh file.
    expect(db.get(`SELECT COUNT(*) c FROM _meta`).c).toBeGreaterThan(0);
    db.close?.();
  });
});

describe("L-2: closeAdapter() racing an in-flight getAdapter()", () => {
  it("close during init rejects the pending init, closes the orphan adapter, and does not leave it published", async () => {
    const created = [];
    forceSqlJs();
    trackSqlJsAdapters(created);

    const d = await import("@/lib/db/driver.js");
    const p1 = d.getAdapter(); // init in flight — do NOT await
    await d.closeAdapter();    // close lands mid-init (old code: no-op, window stays open)

    // Pending init must not silently publish an adapter that was just closed.
    // Old code: p1 RESOLVES and state.instance keeps the orphan → RED.
    await expect(p1).rejects.toThrow(/closed during initialization/i);
    expect(created.length).toBe(1);
    expect(created[0].closed).toBe(true); // orphan handle was closed, not leaked

    // A subsequent getAdapter starts a clean new init (no double-init on the file).
    const db2 = await d.getAdapter();
    expect(db2.driver).toBe("sql.js");
    expect(created.length).toBe(2);
    expect(created[1].closed).toBe(false);
    db2.close?.();
    expect(created[1].closed).toBe(true);
  });
});

describe("H-3 (leak + recovery): init failure AFTER the adapter opened", () => {
  it("runMigrationOnce failure closes the already-opened adapter; retry after repair succeeds without restart", async () => {
    const created = [];
    forceSqlJs();
    trackSqlJsAdapters(created);
    vi.doMock("@/lib/db/migrate.js", () => ({
      MigrationAborted: class MigrationAborted extends Error {},
      runMigrationOnce: async () => {
        throw new Error("simulated migration failure");
      },
    }));

    const d = await import("@/lib/db/driver.js");
    await expect(d.getAdapter()).rejects.toThrow(/simulated migration failure/);
    // Adapter was created before the failing step; it must be closed (old code:
    // leaked open handle + timers → RED).
    expect(created.length).toBe(1);
    expect(created[0].closed).toBe(true);

    // "Repair": restore the real migrate module. Old code: initPromise frozen on
    // the first rejection → this rejects forever → RED.
    vi.doMock("@/lib/db/migrate.js", async (importOriginal) => {
      return await importOriginal();
    });
    const db = await d.getAdapter();
    expect(db.driver).toBe("sql.js");
    expect(created.length).toBe(2);
    expect(created[1].closed).toBe(false);
    db.close?.();
  });
});
