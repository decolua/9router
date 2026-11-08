// Task 3 RED contract — explicit persistence boundary for the DB adapters.
//
// These tests intentionally exercise behavior, not constant existence: every
// positive test awaits adapter.flush() and then observes durable state. Today
// flush() is absent, so the calls throw before any assertion can pass.
//
// Contract expected from GREEN implementation:
// - every adapter exposes flush()
// - sql.js flush() cancels the pending debounce and synchronously persists the
//   dirty database before returning (IO errors propagate; dirty state survives)
// - a rejected transaction is never observable in the exported file as a
//   successful write
// - native adapters expose a callable no-op flush(), because their writes are
//   already durable
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSqlJsAdapter } from "@/lib/db/adapters/sqljsAdapter.js";

const SAVE_DEBOUNCE_MS = 100;

async function detectNativeAdapters() {
  const adapters = [];

  // Mirrors driver.js guards so an unavailable/unsafe native addon is never
  // imported unguarded. better-sqlite3 can SIGSEGV on Node >= 24.
  if (process.versions.bun) {
    try {
      const { createBunSqliteAdapter } = await import("@/lib/db/adapters/bunSqliteAdapter.js");
      adapters.push({ name: "bun:sqlite", factory: createBunSqliteAdapter });
    } catch {
      // unavailable in this runtime
    }
    return adapters;
  }

  const [major, minor] = process.versions.node.split(".").map(Number);

  if (major < 24) {
    try {
      const { createBetterSqliteAdapter } = await import("@/lib/db/adapters/betterSqliteAdapter.js");
      adapters.push({ name: "better-sqlite3", factory: createBetterSqliteAdapter });
    } catch {
      // optional dependency not installed
    }
  }

  if (major > 22 || (major === 22 && minor >= 5)) {
    try {
      const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
      adapters.push({ name: "node:sqlite", factory: createNodeSqliteAdapter });
    } catch {
      // node:sqlite unavailable
    }
  }

  return adapters;
}

const nativeAdapters = await detectNativeAdapters();

let SQLLib = null;
let tempDir = null;
let adapter = null;

beforeAll(async () => {
  SQLLib = await initSqlJs();
});

afterEach(() => {
  try {
    adapter?.close?.();
  } catch {
    // close() persists dirty state; ignore failures in teardown
  }
  adapter = null;

  vi.useRealTimers();
  vi.restoreAllMocks();

  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function createTempDbPath(prefix = "9router-durability-") {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(tempDir, "data.sqlite");
}

function reopenRows(filePath) {
  const db = new SQLLib.Database(fs.readFileSync(filePath));
  try {
    const result = db.exec("SELECT id, value FROM durability ORDER BY id");
    if (result.length === 0) return [];
    const { columns, values } = result[0];
    return values.map((row) =>
      Object.fromEntries(columns.map((column, index) => [column, row[index]]))
    );
  } finally {
    db.close();
  }
}

async function captureFlushError(target) {
  try {
    await target.flush();
    return null;
  } catch (error) {
    return error;
  }
}

function createDurabilityTable(target) {
  target.exec("CREATE TABLE durability (id INTEGER PRIMARY KEY, value TEXT)");
}

describe("sql.js explicit persistence boundary", () => {
  it("committed row is persisted to the exported file before the debounce fires", async () => {
    const filePath = createTempDbPath();
    adapter = await createSqlJsAdapter(filePath);

    // Install fake timers after the async factory resolves, then let the
    // adapter schedule its own debounce. No real sleep is needed anywhere.
    vi.useFakeTimers();

    createDurabilityTable(adapter);
    adapter.run("INSERT INTO durability (id, value) VALUES (?, ?)", [1, "alpha"]);

    expect(fs.existsSync(filePath)).toBe(false);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // RED today: adapter.flush is undefined, so this throws.
    await adapter.flush();

    // flush must cancel the pending debounce, not race it.
    expect(vi.getTimerCount()).toBe(0);
    expect(fs.existsSync(filePath)).toBe(true);

    // Reopening the actual exported bytes proves the row is committed to disk,
    // not merely present in the in-memory sql.js database.
    expect(reopenRows(filePath)).toEqual([{ id: 1, value: "alpha" }]);

    // Advancing past the debounce must not change the persisted snapshot.
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
    expect(reopenRows(filePath)).toEqual([{ id: 1, value: "alpha" }]);
  });

  it("flush failure propagates the IO error and does not acknowledge the lost write", async () => {
    const filePath = createTempDbPath();
    adapter = await createSqlJsAdapter(filePath);

    vi.useFakeTimers();

    createDurabilityTable(adapter);
    adapter.run("INSERT INTO durability (id, value) VALUES (?, ?)", [7, "disk-full"]);

    // Inject a real filesystem failure without touching application data: the
    // destination path becomes a directory, so writeFileSync must fail.
    fs.mkdirSync(filePath);

    const error = await captureFlushError(adapter);

    expect(error).toBeInstanceOf(Error);
    // A missing flush() surfaces as TypeError; an IO failure must be the real
    // error, not an artifact of the absent method.
    expect(error).not.toBeInstanceOf(TypeError);
    expect(["EISDIR", "EPERM", "EACCES"]).toContain(error.code);

    // The failed flush must leave the state dirty so a later retry persists the
    // same acknowledged row instead of silently losing it.
    fs.rmdirSync(filePath);
    await adapter.flush();

    expect(reopenRows(filePath)).toEqual([{ id: 7, value: "disk-full" }]);
  });

  it("does not persist a rolled-back transaction as a successful write", async () => {
    const filePath = createTempDbPath();
    adapter = await createSqlJsAdapter(filePath);
    vi.useFakeTimers();

    createDurabilityTable(adapter);
    adapter.run("INSERT INTO durability (id, value) VALUES (?, ?)", [1, "committed"]);
    await adapter.flush();

    expect(() =>
      adapter.transaction(() => {
        adapter.run("INSERT INTO durability (id, value) VALUES (?, ?)", [2, "rolled-back"]);
        throw new Error("simulated rollback");
      })
    ).toThrow("simulated rollback");

    await adapter.flush();

    expect(reopenRows(filePath)).toEqual([{ id: 1, value: "committed" }]);
  });
});

describe.skipIf(nativeAdapters.length === 0)("native adapter flush compatibility", () => {
  for (const native of nativeAdapters) {
    it(`${native.name} flush is callable and a no-op after a committed write`, async () => {
      const filePath = createTempDbPath("9router-durability-native-");

      adapter = await native.factory(filePath);
      createDurabilityTable(adapter);
      adapter.run("INSERT INTO durability (id, value) VALUES (?, ?)", [11, "native"]);

      // Native adapters write synchronously; flush exists for a uniform
      // persistence boundary and must not reject or mutate durable state.
      await adapter.flush();

      expect(adapter.all("SELECT id, value FROM durability ORDER BY id")).toEqual([
        { id: 11, value: "native" },
      ]);
    });
  }
});
