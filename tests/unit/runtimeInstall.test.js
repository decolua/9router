import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const RUNTIME_HELPER = "../../cli/hooks/runtimeInstall.js";
const SQLITE_HOOK = "../../cli/hooks/sqliteRuntime.js";

let originalPath;
let fakeNpmDir;
let dataDir;
let logPath;

function makeFakeNpm() {
  const npmPath = path.join(fakeNpmDir, "npm");
  const body =
    "#!/usr/bin/env node\n" +
    "const fs = require('fs');\n" +
    "fs.writeFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({\n" +
    "  cwd: process.cwd(),\n" +
    "  argv: process.argv.slice(2)\n" +
    "}));\n" +
    "process.exit(0);\n";
  fs.writeFileSync(npmPath, body);
  fs.chmodSync(npmPath, 0o755);

  // On Windows, also provide a .cmd wrapper that calls the Node script
  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(fakeNpmDir, "npm.cmd"),
      `@echo off\r\nnode "%~dp0npm" %*\r\n`
    );
  }
}

function makeFailingFakeNpm() {
  const npmPath = path.join(fakeNpmDir, "npm");
  const body =
    "#!/usr/bin/env node\n" +
    "const fs = require('fs');\n" +
    "fs.writeFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({\n" +
    "  cwd: process.cwd(),\n" +
    "  argv: process.argv.slice(2)\n" +
    "}));\n" +
    "process.exit(1);\n";
  fs.writeFileSync(npmPath, body);
  fs.chmodSync(npmPath, 0o755);

  if (process.platform === "win32") {
    fs.writeFileSync(
      path.join(fakeNpmDir, "npm.cmd"),
      `@echo off\r\nnode "%~dp0npm" %*\r\n`
    );
  }
}

beforeEach(() => {
  originalPath = process.env.PATH;
  fakeNpmDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fake-npm-"));
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-runtime-test-"));
  logPath = path.join(fakeNpmDir, "npm-log.json");

  process.env.DATA_DIR = dataDir;
  process.env.FAKE_NPM_LOG = logPath;
  process.env.PATH = `${fakeNpmDir}${path.delimiter}${process.env.PATH}`;
});

afterEach(() => {
  process.env.PATH = originalPath;
  delete process.env.DATA_DIR;
  delete process.env.FAKE_NPM_LOG;
  vi.restoreAllMocks();
  fs.rmSync(fakeNpmDir, { recursive: true, force: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("runtimeInstall helper", () => {
  it("ensureRuntimeDir creates the runtime dir and a minimal package.json", async () => {
    const { ensureRuntimeDir } = await import(RUNTIME_HELPER);

    const runtimeDir = ensureRuntimeDir();
    const pkg = JSON.parse(
      fs.readFileSync(path.join(runtimeDir, "package.json"), "utf8")
    );

    expect(runtimeDir).toBe(path.join(dataDir, "runtime"));
    expect(pkg).toMatchObject({
      name: "9router-runtime",
      version: "1.0.0",
      private: true,
    });
  });

  it("installRuntimePackages invokes npm without --no-save", async () => {
    makeFakeNpm();
    const { installRuntimePackages } = await import(RUNTIME_HELPER);

    const ok = installRuntimePackages(["better-sqlite3@12.6.2"], {
      silent: true,
    });

    expect(ok).toBe(true);
    const captured = JSON.parse(fs.readFileSync(logPath, "utf8"));
    expect(captured.cwd).toBe(path.join(dataDir, "runtime"));
    expect(captured.argv).toEqual([
      "install",
      "better-sqlite3@12.6.2",
      "--no-audit",
      "--no-fund",
      "--prefer-online",
    ]);
    expect(captured.argv).not.toContain("--no-save");
  });

  it("installRuntimePackages logs a package-specific warning on failure", async () => {
    makeFailingFakeNpm();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { installRuntimePackages } = await import(RUNTIME_HELPER);

    const ok = installRuntimePackages(["systray2@2.1.4"], {
      silent: false,
      timeout: 120000,
      label: "system tray",
      failureTitle: "System tray install failed — tray disabled",
      failureHint: "tray disabled",
    });

    expect(ok).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      "⚠️  System tray install failed — tray disabled"
    );
  });

  it("sqliteRuntime re-exports the runtime primitives for existing callers", async () => {
    // Use a CJS require so we get the actual module.exports of the file
    // (the sqlite hook is CommonJS in production).
    const { createRequire } = await import("module");
    const req = createRequire(import.meta.url);
    const sqliteHook = req(SQLITE_HOOK);

    expect(typeof sqliteHook.getRuntimeDir).toBe("function");
    expect(typeof sqliteHook.getRuntimeNodeModules).toBe("function");
    expect(typeof sqliteHook.runNpmInstall).toBe("function");
    expect(typeof sqliteHook.summarizeNpmError).toBe("function");
  });
});
