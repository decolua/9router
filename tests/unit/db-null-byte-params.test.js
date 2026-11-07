// Regression: SQLite binds TEXT as a NUL-terminated C string, so a bound
// string with an embedded NUL cannot survive the write.
//
//  - better-sqlite3 rejects it: "TypeError: String contains null byte",
//    which aborts the write and with it the background flush worker.
//  - node:sqlite accepts it and silently keeps only the prefix before the
//    NUL — the rest of the value is gone with no trace.
//
// Telemetry carries values that can contain one: a model id or endpoint taken
// straight from the request, raw bytes out of a tool result, a diff. The write
// must survive and must keep the whole value. (#4917)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { stripNullBytes } from "@/lib/db/helpers/nullBytes.js";

// Built at runtime so the source file itself holds no literal NUL byte.
const NUL = String.fromCharCode(0);
const DIRTY = `before${NUL}after`;

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-nul-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  // driver.js captures the shared state object at module load, so the module
  // has to be re-imported for each test to get a fresh (open) database.
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("stripNullBytes", () => {
  it("removes NUL bytes and keeps the rest of the text", () => {
    expect(stripNullBytes(DIRTY)).toBe("beforeafter");
    expect(stripNullBytes(`a${NUL}b`)).toBe("ab");
  });

  it("leaves clean strings untouched", () => {
    expect(stripNullBytes("plain text")).toBe("plain text");
    expect(stripNullBytes("")).toBe("");
  });

  it("passes non-string values through", () => {
    expect(stripNullBytes(null)).toBe(null);
    expect(stripNullBytes(undefined)).toBe(undefined);
    expect(stripNullBytes(42)).toBe(42);
    const buf = Buffer.from([0, 1, 2]);
    expect(stripNullBytes(buf)).toBe(buf);
  });
});

describe("driver binds NUL-containing strings safely", () => {
  it("stores the whole value instead of throwing or truncating", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    db.run("CREATE TABLE IF NOT EXISTS nulTest (id INTEGER PRIMARY KEY, label TEXT)");

    expect(() => db.run("INSERT INTO nulTest (label) VALUES (?)", [DIRTY])).not.toThrow();

    const row = db.get("SELECT label FROM nulTest");
    expect(row.label).toBe("beforeafter");
  });

  it("keeps a NUL out of a lookup value too", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    db.run("CREATE TABLE IF NOT EXISTS nulLookup (id INTEGER PRIMARY KEY, label TEXT)");
    db.run("INSERT INTO nulLookup (label) VALUES (?)", [DIRTY]);

    const row = db.get("SELECT label FROM nulLookup WHERE label = ?", [DIRTY]);
    expect(row?.label).toBe("beforeafter");
  });

  it("leaves the driver identity and the other methods intact", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    expect(["better-sqlite3", "node:sqlite", "sql.js", "bun:sqlite"]).toContain(db.driver);
    expect(typeof db.exec).toBe("function");
    expect(typeof db.transaction).toBe("function");
  });
});
