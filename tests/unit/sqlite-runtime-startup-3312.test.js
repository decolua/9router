import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const modulePath = require.resolve("../../cli/hooks/sqliteRuntime.js");

let dataDir;
let previousDataDir;

function loadRuntimeHook() {
  delete require.cache[modulePath];
  return require(modulePath);
}

function seedSqlJsFallback() {
  const wasm = path.join(dataDir, "runtime", "node_modules", "sql.js", "dist", "sql-wasm.wasm");
  fs.mkdirSync(path.dirname(wasm), { recursive: true });
  fs.writeFileSync(wasm, "wasm");
}

beforeEach(() => {
  previousDataDir = process.env.DATA_DIR;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-sqlite-runtime-"));
  process.env.DATA_DIR = dataDir;
  seedSqlJsFallback();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete require.cache[modulePath];
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("SQLite runtime startup (#3312)", () => {
  it("does not invoke npm for missing better-sqlite3 during normal startup", () => {
    const spawnSync = vi.spyOn(childProcess, "spawnSync");
    const { ensureSqliteRuntime } = loadRuntimeHook();

    expect(ensureSqliteRuntime({ silent: true })).toEqual({
      betterSqlite: false,
      sqlJs: true,
    });
    expect(spawnSync).not.toHaveBeenCalled();
  });

  it("limits the postinstall native warm-up to 30 seconds on a Node 26-compatible version", () => {
    const spawnSync = vi.spyOn(childProcess, "spawnSync").mockReturnValue({
      status: null,
      stderr: "timed out",
      stdout: "",
    });
    const { ensureSqliteRuntime } = loadRuntimeHook();

    expect(ensureSqliteRuntime({ silent: true, installBetterSqlite: true })).toEqual({
      betterSqlite: false,
      sqlJs: true,
    });
    expect(spawnSync).toHaveBeenCalledWith(
      expect.stringMatching(/^npm(?:\.cmd)?$/),
      expect.arrayContaining(["better-sqlite3@12.10.1", "--no-save"]),
      expect.objectContaining({ timeout: 30000 }),
    );
  });
});
