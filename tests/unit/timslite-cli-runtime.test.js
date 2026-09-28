import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const sqliteRuntime = require("../../cli/hooks/sqliteRuntime.js");

const tempDirs = [];

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-sqlite-runtime-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.DATA_DIR;
});

function runtimeNodeModules(dataDir) {
  return path.join(dataDir, "runtime", "node_modules");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function betterSqliteMagic() {
  if (process.platform === "linux") return "7f454c46";
  if (process.platform === "win32") return "4d5a";
  return "cffaedfe";
}

function writeBetterSqliteBinary(dataDir) {
  const root = path.join(runtimeNodeModules(dataDir), "better-sqlite3");
  writeJson(path.join(root, "package.json"), { name: "better-sqlite3", version: "12.6.2" });
  const binary = path.join(root, "build", "Release", "better_sqlite3.node");
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, Buffer.from(betterSqliteMagic(), "hex"));
}

function writeSqlJsWasm(dataDir) {
  const wasm = path.join(runtimeNodeModules(dataDir), "sql.js", "dist", "sql-wasm.wasm");
  fs.mkdirSync(path.dirname(wasm), { recursive: true });
  fs.writeFileSync(wasm, "wasm");
}

function writeTimsliteBinding(dataDir) {
  const root = path.join(runtimeNodeModules(dataDir), "timslite");
  writeJson(path.join(root, "package.json"), { name: "timslite", main: "index.js" });
  fs.writeFileSync(path.join(root, sqliteRuntime.getTimsliteBindingFilename()), "binding");
}

describe("CLI sqlite runtime covers optional timslite", () => {
  it("exposes the platform-specific timslite binding filename", () => {
    const filename = sqliteRuntime.getTimsliteBindingFilename();
    expect(filename).toMatch(/^timslite\..+\.node$/);
  });

  it("detects an installed timslite binding", () => {
    const dataDir = createTempDir();
    process.env.DATA_DIR = dataDir;
    writeTimsliteBinding(dataDir);
    expect(sqliteRuntime.hasTimsliteBinding()).toBe(true);
  });

  it("reports no timslite binding when the optional package is absent", () => {
    const dataDir = createTempDir();
    process.env.DATA_DIR = dataDir;
    fs.mkdirSync(path.join(dataDir, "runtime", "node_modules", "timslite"), { recursive: true });
    expect(sqliteRuntime.hasTimsliteBinding()).toBe(false);
  });

  it("includes timslite readiness in the sqlite runtime warm-up", () => {
    const dataDir = createTempDir();
    process.env.DATA_DIR = dataDir;
    writeBetterSqliteBinary(dataDir);
    writeSqlJsWasm(dataDir);
    writeTimsliteBinding(dataDir);

    const result = sqliteRuntime.ensureSqliteRuntime({ silent: true });
    expect(result.betterSqlite).toBe(true);
    expect(result.sqlJs).toBe(true);
    expect(result.timslite).toBe(true);
  });
});
