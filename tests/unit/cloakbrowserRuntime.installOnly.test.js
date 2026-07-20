import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireCJS = createRequire(import.meta.url);

const sqliteRuntimePath = path.resolve(__dirname, "../../cli/hooks/sqliteRuntime.js");
const automationRuntimePath = path.resolve(__dirname, "../../cli/hooks/automationRuntime.js");
const cloakbrowserRuntimePath = path.resolve(__dirname, "../../cli/hooks/cloakbrowserRuntime.js");

describe("cloakbrowserRuntime", () => {
  let mod;
  let sqliteMod;
  let existsSyncSpy;
  let previousDataDir;
  let previousCloakbrowserCacheDir;
  let previousCloakbrowserAutoUpdate;
  let dataDir;

  beforeEach(() => {
    delete requireCJS.cache?.[cloakbrowserRuntimePath];
    delete requireCJS.cache?.[automationRuntimePath];
    delete requireCJS.cache?.[sqliteRuntimePath];

    previousDataDir = process.env.DATA_DIR;
    previousCloakbrowserCacheDir = process.env.CLOAKBROWSER_CACHE_DIR;
    previousCloakbrowserAutoUpdate = process.env.CLOAKBROWSER_AUTO_UPDATE;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cloakbrowser-runtime-"));
    process.env.DATA_DIR = dataDir;
    delete process.env.CLOAKBROWSER_CACHE_DIR;
    delete process.env.CLOAKBROWSER_AUTO_UPDATE;

    sqliteMod = requireCJS(sqliteRuntimePath);
    vi.spyOn(sqliteMod, "runNpmInstall");
    vi.spyOn(sqliteMod, "getRuntimeDir").mockReturnValue("/fake/runtime");
    vi.spyOn(sqliteMod, "getRuntimeNodeModules").mockReturnValue("/fake/runtime/node_modules");

    existsSyncSpy = vi.spyOn(fs, "existsSync");

    delete requireCJS.cache?.[cloakbrowserRuntimePath];
    mod = requireCJS(cloakbrowserRuntimePath);
  });

  afterEach(() => {
    delete requireCJS.cache?.[cloakbrowserRuntimePath];
    delete requireCJS.cache?.[automationRuntimePath];
    delete requireCJS.cache?.[sqliteRuntimePath];
    vi.restoreAllMocks();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    if (previousCloakbrowserCacheDir === undefined) delete process.env.CLOAKBROWSER_CACHE_DIR;
    else process.env.CLOAKBROWSER_CACHE_DIR = previousCloakbrowserCacheDir;
    if (previousCloakbrowserAutoUpdate === undefined) delete process.env.CLOAKBROWSER_AUTO_UPDATE;
    else process.env.CLOAKBROWSER_AUTO_UPDATE = previousCloakbrowserAutoUpdate;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("exports the Cloakbrowser runtime functions", () => {
    expect(typeof mod.installCloakbrowserOnly).toBe("function");
    expect(typeof mod.ensureCloakbrowserRuntime).toBe("function");
    expect(typeof mod.loadCloakbrowserModule).toBe("function");
    expect(typeof mod.importCloakbrowserModule).toBe("function");
  });

  it("loads the ESM-only Cloakbrowser package from automation runtime", async () => {
    const packageDir = path.join(dataDir, "automation-runtime", "node_modules", "cloakbrowser");
    fs.mkdirSync(path.join(packageDir, "dist"), { recursive: true });
    fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({
      name: "cloakbrowser",
      version: "0.4.8",
      type: "module",
      main: "dist/index.js",
      exports: {
        ".": {
          import: "./dist/index.js",
        },
      },
    }, null, 2));
    fs.writeFileSync(path.join(packageDir, "dist", "index.js"), "export function launch() { return 'ok'; }\n");

    const imported = await mod.importCloakbrowserModule();
    const ensured = await mod.ensureCloakbrowserRuntime({ silent: true });

    expect(imported?.launch()).toBe("ok");
    expect(ensured.ok).toBe(true);
    expect(ensured.module?.launch()).toBe("ok");
    expect(process.env.CLOAKBROWSER_CACHE_DIR).toBe(path.join(dataDir, "automation-runtime", "cloakbrowser"));
    expect(process.env.CLOAKBROWSER_AUTO_UPDATE).toBe("false");
    expect(sqliteMod.runNpmInstall).not.toHaveBeenCalled();
  });

  it("downloads the Cloakbrowser binary when the package exposes ensureBinary", async () => {
    const packageDir = path.join(dataDir, "automation-runtime", "node_modules", "cloakbrowser");
    const binaryPath = path.join(dataDir, "automation-runtime", "cloakbrowser", "chromium-test", "chrome");
    fs.mkdirSync(path.join(packageDir, "dist"), { recursive: true });
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    fs.writeFileSync(binaryPath, "#!/bin/sh\n");
    fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({
      name: "cloakbrowser",
      version: "0.4.8",
      type: "module",
      main: "dist/index.js",
    }, null, 2));
    fs.writeFileSync(path.join(packageDir, "dist", "index.js"), `
export function launch() { return 'ok'; }
export async function ensureBinary() { return ${JSON.stringify(binaryPath)}; }
`);

    const ensured = await mod.ensureCloakbrowserRuntime({ silent: true });

    expect(ensured.ok).toBe(true);
    expect(ensured.module?.launch()).toBe("ok");
  });

  it("installs Cloakbrowser runtime packages into the automation runtime", () => {
    sqliteMod.runNpmInstall.mockReturnValue({ ok: true, code: 0, stderr: "", stdout: "" });
    existsSyncSpy.mockImplementation((value) => String(value).includes("cloakbrowser"));

    const result = mod.installCloakbrowserOnly({ silent: true });

    expect(result).toEqual({ ok: true });
    expect(sqliteMod.runNpmInstall).toHaveBeenCalledWith({
      cwd: path.join(dataDir, "automation-runtime"),
      pkgs: expect.arrayContaining([
        "cloakbrowser@0.4.8",
        expect.stringMatching(/^playwright-core@/),
        expect.stringMatching(/^puppeteer-core@/),
        expect.stringMatching(/^socks-proxy-agent@/),
        expect.stringMatching(/^mmdb-lib@/),
      ]),
      extraArgs: ["--no-save"],
      timeout: 300_000,
    });
  });
});
