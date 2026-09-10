// Installing a SIGINT/SIGTERM listener replaces Node's default terminate action.
// Every DB adapter installs one to flush before shutdown, so each of them also
// has to exit — otherwise Ctrl-C is swallowed and `docker stop` waits out its
// full grace period before SIGKILL.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSqlJsAdapter } from "../../src/lib/db/adapters/sqljsAdapter.js";

const SIGNALS = ["SIGINT", "SIGTERM"];

let tempDir;
let adapter;
let baseline;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-sqljs-shutdown-"));
  baseline = Object.fromEntries(SIGNALS.map((s) => [s, process.listeners(s).slice()]));
});

afterEach(() => {
  try { adapter?.close(); } catch { /* already closed */ }
  adapter = undefined;
  // Drop whatever the adapter installed so one test cannot affect the next.
  for (const signal of SIGNALS) {
    for (const listener of process.listeners(signal)) {
      if (!baseline[signal].includes(listener)) process.removeListener(signal, listener);
    }
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function makeAdapter() {
  adapter = await createSqlJsAdapter(path.join(tempDir, "data.sqlite"));
  return adapter;
}

const added = (signal) => process.listeners(signal).filter((l) => !baseline[signal].includes(l));

describe("sql.js adapter shutdown", () => {
  it.each(SIGNALS)("%s exits the process after flushing", async (signal) => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {});
    try {
      await makeAdapter();
      expect(added(signal)).toHaveLength(1);

      process.emit(signal);

      // Without this the handler flushes and returns, and because a listener is
      // registered Node no longer terminates on the signal either.
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      exit.mockRestore();
    }
  });

  it.each(SIGNALS)("does not keep handling %s after the first one", async (signal) => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {});
    try {
      await makeAdapter();
      process.emit(signal);
      // Registered with `once`, so the handler is consumed. `on` would leave it
      // in place and stack another one per adapter created.
      expect(added(signal)).toHaveLength(0);
    } finally {
      exit.mockRestore();
    }
  });

  it("still persists a pending write when the signal arrives", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {});
    try {
      const db = await makeAdapter();
      const file = path.join(tempDir, "data.sqlite");
      db.exec("CREATE TABLE t (v TEXT)");
      db.run("INSERT INTO t(v) VALUES(?)", ["kept"]);
      expect(fs.existsSync(file)).toBe(false); // the save is debounced

      process.emit("SIGTERM");

      expect(fs.existsSync(file)).toBe(true);
      expect(fs.statSync(file).size).toBeGreaterThan(0);
    } finally {
      exit.mockRestore();
    }
  });
});
