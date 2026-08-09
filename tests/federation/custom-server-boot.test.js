// FED-014 — npm start boots the federation-aware custom-server.js wrapper.
//
// Covers (FED-014 acceptance):
//  - Unit: resolveStandaloneServerPath returns the Docker-layout path when
//    server.js sits next to custom-server.js; returns the
//    .next/standalone/server.js path when only that exists; returns null
//    when neither exists. (Exercised in a spawned node child — importing
//    custom-server.js into the vitest module context would leak its
//    top-level http.createServer monkeypatch into the test runner.)
//  - Unit: instrumentation.js register() in edge mode WITHOUT the wrapper
//    marker emits a LOUD console.error and never throws; with the marker
//    (or in central/standalone) it stays silent. The FED-013 loop starter
//    call is preserved exactly.
//  - Spawn smoke: `node custom-server.js` from a temp dir with ONLY a stub
//    server.js requires it (Docker-layout equivalence end-to-end); with
//    NEITHER layout it exits non-zero with the loud FATAL message.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CUSTOM_SERVER = path.join(REPO_ROOT, "custom-server.js");

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-boot-"));
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

// ─── Unit: resolveStandaloneServerPath (spawned node child) ──────────────

function resolveViaChild(dir) {
  const script =
    `const m = require(${JSON.stringify(CUSTOM_SERVER)});` +
    `process.stdout.write(JSON.stringify(m.resolveStandaloneServerPath({ dir: process.argv[1] })));`;
  const out = execFileSync(process.execPath, ["-e", script, dir], { encoding: "utf8" });
  return JSON.parse(out);
}

describe("resolveStandaloneServerPath — unit (spawned child)", () => {
  it("returns the Docker-layout path when server.js sits next to custom-server.js", () => {
    fs.writeFileSync(path.join(tempDir, "server.js"), "// stub\n");
    expect(resolveViaChild(tempDir)).toBe(path.join(tempDir, "server.js"));
  });

  it("returns the .next/standalone path when only the repo layout exists", () => {
    const standalone = path.join(tempDir, ".next", "standalone");
    fs.mkdirSync(standalone, { recursive: true });
    fs.writeFileSync(path.join(standalone, "server.js"), "// stub\n");
    expect(resolveViaChild(tempDir)).toBe(path.join(standalone, "server.js"));
  });

  it("prefers the Docker layout when both exist (Docker CMD compatibility)", () => {
    fs.writeFileSync(path.join(tempDir, "server.js"), "// stub\n");
    const standalone = path.join(tempDir, ".next", "standalone");
    fs.mkdirSync(standalone, { recursive: true });
    fs.writeFileSync(path.join(standalone, "server.js"), "// stub\n");
    expect(resolveViaChild(tempDir)).toBe(path.join(tempDir, "server.js"));
  });

  it("returns null when neither layout exists", () => {
    expect(resolveViaChild(tempDir)).toBeNull();
  });
});

// ─── Spawn smoke: real `node custom-server.js` in both layouts ───────────

describe("custom-server.js boot — spawn smoke", () => {
  it("Docker layout: requires ./server.js (stub writes a marker file)", () => {
    fs.copyFileSync(CUSTOM_SERVER, path.join(tempDir, "custom-server.js"));
    const marker = path.join(tempDir, "required.marker");
    fs.writeFileSync(
      path.join(tempDir, "server.js"),
      `require("fs").writeFileSync(process.env.MARKER_PATH, "required");\n`
    );
    const res = spawnSync(process.execPath, ["custom-server.js"], {
      cwd: tempDir,
      env: { ...process.env, MARKER_PATH: marker },
      encoding: "utf8",
      timeout: 15000,
    });
    expect(res.status).toBe(0);
    expect(fs.existsSync(marker)).toBe(true);
    expect(fs.readFileSync(marker, "utf8")).toBe("required");
  });

  it("neither layout: exits non-zero with the loud FATAL message", () => {
    fs.copyFileSync(CUSTOM_SERVER, path.join(tempDir, "custom-server.js"));
    const res = spawnSync(process.execPath, ["custom-server.js"], {
      cwd: tempDir,
      env: { ...process.env },
      encoding: "utf8",
      timeout: 15000,
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/FATAL: cannot locate the Next standalone server/);
    expect(res.stderr).toMatch(/npm run build/);
  });
});

// ─── FED-017: plain-node runtime graph loads WITHOUT the @/lib alias ─────
//
// custom-server.js dynamically imports the federation modules via file://
// URLs (plain node — no Next bundler, no jsconfig @/* alias). Before
// FED-017, src/lib/db/paths.js imported "@/lib/dataDir.js", which plain
// node cannot resolve in the repo layout ("Cannot find package @/lib
// imported from src/lib/db/paths.js") — the failover/queue/edgeClient
// chain silently failed to load and the edge never replicated. This test
// spawns REAL plain node (not vitest, whose resolver maps @/) and asserts
// every module in the runtime graph imports cleanly.

describe("FED-017 — plain-node runtime graph (no @/ alias)", () => {
  const MODULES = [
    "src/lib/db/paths.js",
    "src/lib/db/driver.js",
    "src/lib/federation/failover.js",
    "src/lib/federation/edgeClient.js",
    "src/lib/federation/queue.js",
    "src/lib/federation/proxy.js",
    "src/lib/federation/state.js",
    "src/lib/federation/headers.js",
    "src/lib/federation/startLoops.js",
  ];

  it("every module in the custom-server runtime graph imports under plain node", () => {
    const importExpr = MODULES.map(
      (m) => `await import(${JSON.stringify(path.join(REPO_ROOT, m))})`
    ).join(";");
    const script = `(async () => { ${importExpr}; })();`;
    const res = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATA_DIR: tempDir },
      encoding: "utf8",
      timeout: 20000,
    });
    expect(res.status).toBe(0);
    expect(res.stderr).not.toMatch(/Cannot find package @\/lib/);
  });

  it("src/lib/db/paths.js has NO remaining @/lib imports (regression anchor)", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src/lib/db/paths.js"), "utf8");
    expect(src).not.toMatch(/@\/lib/);
  });
});

// ─── Unit: instrumentation.js edge-without-wrapper loud error ────────────

// Mock the side-effecting imports so register() is pure to test:
// initConsoleLogCapture patches console; startFederationLoops would start
// real timers in edge mode.
vi.mock("@/lib/consoleLogBuffer", () => ({ initConsoleLogCapture: vi.fn() }));
vi.mock("@/lib/federation/startLoops", () => ({
  startFederationLoops: vi.fn(async () => ({ started: true })),
}));

const { register } = await import("@/instrumentation.js");
const { startFederationLoops } = await import("@/lib/federation/startLoops");

describe("instrumentation register() — wrapper-absent edge warning", () => {
  let savedRuntime;
  let savedMode;
  let savedMarker;
  let errorSpy;

  beforeEach(() => {
    savedRuntime = process.env.NEXT_RUNTIME;
    savedMode = process.env.FEDERATION_MODE;
    savedMarker = globalThis.__9ROUTER_CUSTOM_SERVER__;
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.FEDERATION_MODE;
    delete globalThis.__9ROUTER_CUSTOM_SERVER__;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    startFederationLoops.mockClear();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    if (savedRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = savedRuntime;
    if (savedMode === undefined) delete process.env.FEDERATION_MODE;
    else process.env.FEDERATION_MODE = savedMode;
    if (savedMarker === undefined) delete globalThis.__9ROUTER_CUSTOM_SERVER__;
    else globalThis.__9ROUTER_CUSTOM_SERVER__ = savedMarker;
  });

  it("edge mode without the wrapper marker: LOUD error, never throws, loops still start", async () => {
    process.env.FEDERATION_MODE = "edge";
    await expect(register()).resolves.toBeUndefined();
    const warnings = errorSpy.mock.calls.filter((args) =>
      String(args[0]).includes("custom-server.js wrapper is NOT active")
    );
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0][0])).toMatch(/npm start/);
    // FED-013 loop starter call preserved exactly.
    expect(startFederationLoops).toHaveBeenCalledTimes(1);
  });

  it("edge mode WITH the wrapper marker: no wrapper warning, loops still start", async () => {
    process.env.FEDERATION_MODE = "edge";
    globalThis.__9ROUTER_CUSTOM_SERVER__ = true;
    await expect(register()).resolves.toBeUndefined();
    const warnings = errorSpy.mock.calls.filter((args) =>
      String(args[0]).includes("wrapper is NOT active")
    );
    expect(warnings).toHaveLength(0);
    expect(startFederationLoops).toHaveBeenCalledTimes(1);
  });

  it("central mode: completely silent, no loop start (zero drift)", async () => {
    process.env.FEDERATION_MODE = "central";
    await expect(register()).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(startFederationLoops).not.toHaveBeenCalled();
  });

  it("standalone (mode unset): completely silent, no loop start (zero drift)", async () => {
    await expect(register()).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(startFederationLoops).not.toHaveBeenCalled();
  });
});
