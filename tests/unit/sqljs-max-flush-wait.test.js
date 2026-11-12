// sql.js runs fully in memory and mirrors to disk on a debounced save. A plain
// trailing debounce re-arms on every write, so sustained writes <100 ms apart
// never reach disk until traffic stops — a crash loses everything since the
// last quiet moment. There must be a maximum wait on top of the debounce.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSqlJsAdapter } from "../../src/lib/db/adapters/sqljsAdapter.js";

const SCRATCH = os.tmpdir();

let dir;
let file;
let adapter;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(SCRATCH, "sqljs-maxwait-"));
  file = path.join(dir, "data.sqlite");
});

afterEach(() => {
  try { adapter?.close(); } catch {}
  adapter = null;
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

function diskRowCount(SQL) {
  const db = new SQL.Database(fs.readFileSync(file));
  try {
    const res = db.exec("SELECT COUNT(*) FROM t");
    return res[0]?.values?.[0]?.[0] ?? 0;
  } finally {
    db.close();
  }
}

describe("sql.js save has a maximum wait", () => {
  it("flushes at least every ~1s while writes keep arriving faster than the debounce", async () => {
    const SQL = await initSqlJs();
    adapter = await createSqlJsAdapter(file);
    adapter.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    // Let the schema save (real timer) settle before the sustained-write window.
    await new Promise((r) => setTimeout(r, 150));

    vi.useFakeTimers();
    // 30 writes, one every 50 ms (half the 100 ms debounce) => 1500 ms of
    // traffic. A pure trailing debounce never fires; the max wait must.
    for (let i = 0; i < 30; i++) {
      adapter.run("INSERT INTO t(v) VALUES (?)", [`v${i}`]);
      vi.advanceTimersByTime(50);
    }

    expect(diskRowCount(SQL)).toBeGreaterThanOrEqual(20);
  });
});
