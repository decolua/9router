import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";
import childProcess from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireCJS = createRequire(import.meta.url);
const realExistsSync = fs.existsSync;

function makeSpawnSyncResult(status, stderr = "") {
  return { status, stderr, stdout: "", pid: 1, signal: null, error: null };
}

const sqliteRuntimePath = path.resolve(__dirname, "../../cli/hooks/sqliteRuntime.js");
const automationRuntimePath = path.resolve(__dirname, "../../cli/hooks/automationRuntime.js");
const playwrightRuntimePath = path.resolve(__dirname, "../../cli/hooks/playwrightRuntime.js");

describe("installPlaywrightOnly", () => {
  let mod;
  let sqliteMod;
  let automationMod;
  let spawnSyncSpy;
  let existsSyncSpy;

  beforeEach(() => {
    delete requireCJS.cache?.[playwrightRuntimePath];
    delete requireCJS.cache?.[automationRuntimePath];
    delete requireCJS.cache?.[sqliteRuntimePath];

    sqliteMod = requireCJS(sqliteRuntimePath);
    vi.spyOn(sqliteMod, "getRuntimeDir").mockReturnValue("/fake/runtime");
    vi.spyOn(sqliteMod, "getRuntimeNodeModules").mockReturnValue("/fake/runtime/node_modules");
    automationMod = requireCJS(automationRuntimePath);
    vi.spyOn(automationMod, "ensureAutomationRuntimeDir").mockReturnValue("/fake/automation-runtime");
    vi.spyOn(automationMod, "getAutomationRuntimeDir").mockReturnValue("/fake/automation-runtime");
    vi.spyOn(automationMod, "getAutomationRuntimeNodeModules").mockReturnValue("/fake/automation-runtime/node_modules");
    vi.spyOn(automationMod, "installAutomationPackages");
    vi.spyOn(automationMod, "configureAutomationBrowserEnv").mockImplementation((env = process.env) => env);

    spawnSyncSpy = vi.spyOn(childProcess, "spawnSync");
    existsSyncSpy = vi.spyOn(fs, "existsSync");

    delete requireCJS.cache?.[playwrightRuntimePath];
    mod = requireCJS(playwrightRuntimePath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports installPlaywrightOnly as a function", () => {
    expect(typeof mod.installPlaywrightOnly).toBe("function");
  });

  it("pins Playwright runtime version instead of floating to latest", () => {
    expect(automationMod.PLAYWRIGHT_VERSION).toBe("1.54.2");
  });

  it("happy path: npm install ok + chromium fetch ok → { ok: true }", () => {
    automationMod.installAutomationPackages.mockReturnValue({ ok: true, code: 0, stderr: "", stdout: "" });
    existsSyncSpy.mockImplementation((p) => String(p).includes("cli.js"));
    spawnSyncSpy.mockReturnValue(makeSpawnSyncResult(0));

    const result = mod.installPlaywrightOnly({ silent: true });
    expect(result).toEqual({ ok: true });
    expect(automationMod.installAutomationPackages).toHaveBeenCalledOnce();
    expect(spawnSyncSpy).toHaveBeenCalledOnce();
  });

  it("npm install fails with network error → { ok: false, reason includes network/internet/registry }", () => {
    automationMod.installAutomationPackages.mockReturnValue({
      ok: false,
      code: 1,
      stderr: "npm ERR! code ENOTFOUND\nnpm ERR! getaddrinfo ENOTFOUND registry.npmjs.org",
      stdout: "",
    });

    const result = mod.installPlaywrightOnly({ silent: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.reason.toLowerCase()).toMatch(/network|internet|registry/);
  });

  it("npm install fails with permission error → { ok: false, reason includes 'permission' }", () => {
    automationMod.installAutomationPackages.mockReturnValue({
      ok: false,
      code: 1,
      stderr: "npm ERR! code EACCES\nnpm ERR! permission denied",
      stdout: "",
    });

    const result = mod.installPlaywrightOnly({ silent: true });
    expect(result.ok).toBe(false);
    expect(result.reason.toLowerCase()).toMatch(/permission/);
  });

  it("npm install fails with disk space error → { ok: false, reason includes disk/space }", () => {
    automationMod.installAutomationPackages.mockReturnValue({
      ok: false,
      code: 1,
      stderr: "npm ERR! ENOSPC: no space left on device",
      stdout: "",
    });

    const result = mod.installPlaywrightOnly({ silent: true });
    expect(result.ok).toBe(false);
    expect(result.reason.toLowerCase()).toMatch(/disk|space/);
  });

  it("npm install ok but cli.js not found → { ok: false, reason }", () => {
    automationMod.installAutomationPackages.mockReturnValue({ ok: true, code: 0, stderr: "", stdout: "" });
    existsSyncSpy.mockReturnValue(false);

    const result = mod.installPlaywrightOnly({ silent: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("npm install ok, cli.js exists, chromium fetch fails → { ok: false, reason }", () => {
    automationMod.installAutomationPackages.mockReturnValue({ ok: true, code: 0, stderr: "", stdout: "" });
    existsSyncSpy.mockImplementation((p) => String(p).includes("cli.js"));
    spawnSyncSpy.mockReturnValue(makeSpawnSyncResult(1, "ENOTFOUND registry.npmjs.org"));

    const result = mod.installPlaywrightOnly({ silent: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("does NOT throw even when playwright package is not resolvable", () => {
    automationMod.installAutomationPackages.mockReturnValue({ ok: true, code: 0, stderr: "", stdout: "" });
    existsSyncSpy.mockImplementation((p) => String(p).includes("cli.js"));
    spawnSyncSpy.mockReturnValue(makeSpawnSyncResult(0));

    expect(() => mod.installPlaywrightOnly({ silent: true })).not.toThrow();
  });

  it("loads Playwright from the 9router runtime node_modules", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "klrouter-playwright-runtime-"));
    const nodeModules = path.join(root, "node_modules");
    const playwrightDir = path.join(nodeModules, "playwright");
    fs.mkdirSync(playwrightDir, { recursive: true });
    fs.writeFileSync(path.join(playwrightDir, "package.json"), JSON.stringify({
      name: "playwright",
      main: "index.js",
    }));
    fs.writeFileSync(path.join(playwrightDir, "index.js"), "module.exports = { chromium: { runtimeLoaded: true }, firefox: { runtimeLoaded: true } };");
    sqliteMod.getRuntimeNodeModules.mockReturnValue(nodeModules);

    delete requireCJS.cache?.[playwrightRuntimePath];
    mod = requireCJS(playwrightRuntimePath);

    const loaded = mod.loadPlaywrightModule();
    expect(loaded?.chromium).toBeTruthy();
    expect(loaded?.firefox).toBeTruthy();
  });

  it("ensurePlaywrightRuntime uses bundled Playwright before installing into automation runtime", () => {
    const repoPlaywrightPkg = path.resolve(__dirname, "../../node_modules/playwright/package.json");
    automationMod.installAutomationPackages.mockReturnValue({
      ok: false,
      code: 1,
      stderr: "npm ERR! code ENOTFOUND",
      stdout: "",
    });
    existsSyncSpy.mockImplementation((p) => {
      const filePath = String(p);
      if (filePath === "/fake/automation-runtime/node_modules/playwright/package.json") return false;
      if (filePath === repoPlaywrightPkg) return true;
      if (/chrom(e|ium)/i.test(filePath)) return true;
      return realExistsSync(p);
    });

    const result = mod.ensurePlaywrightRuntime({ silent: true });

    expect(result.ok).toBe(true);
    expect(automationMod.installAutomationPackages).not.toHaveBeenCalled();
  });
});
