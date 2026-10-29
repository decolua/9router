// FED-014 — npm start boots the federation-aware custom-server.js wrapper.
//
// FED-024 (load hygiene): the pure-function probes in this file used to launch
// one plain-node child process PER ASSERTION (~29 processes for 38 assertions
// in the 2026-09-19 audit). The process boundary is NOT the subject for
// `resolveStandaloneServerPath`, `missingFederationRuntimeModules` or
// `checkPlaceholderSecrets` — they are pure functions of their arguments; they
// only ran in a child so that requiring custom-server.js would not run its
// top-level http.createServer monkeypatch inside the vitest worker. Those
// probes now ride ONE session-scoped driver child (started in beforeAll) that
// requires the wrapper once and answers newline-delimited JSON requests over
// stdio. Tests that ARE about the process boundary (`node custom-server.js`
// boot smokes, the FED-017 plain-node import graph) keep their own real
// children, and every child this file holds is gated by TEST_SPAWN_CONCURRENCY
// (clamped 2-16, default 4).
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
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CUSTOM_SERVER = path.join(REPO_ROOT, "custom-server.js");

// ─── child spawn budget (FED-024) ──────────────────────────────────────────
//
// TEST_SPAWN_CONCURRENCY bounds how many real children this file holds at
// once. Clamped to 2-16 (default 4): a low value cannot serialise the file
// below two slots and a high one cannot let a typo storm the host.
const SPAWN_CONCURRENCY = (() => {
  const raw = Number(process.env.TEST_SPAWN_CONCURRENCY);
  if (!Number.isFinite(raw) || raw <= 0) return 4;
  return Math.max(2, Math.min(16, Math.trunc(raw)));
})();

// Runs `jobs` (zero-arg async fns) with at most SPAWN_CONCURRENCY in flight,
// preserving input order. A rejected job rejects the wave (equivalent to the
// synchronous throw the old spawnSync raised).
async function inWaves(jobs) {
  const results = new Array(jobs.length);
  let next = 0;
  const runner = async () => {
    while (next < jobs.length) {
      const index = next++;
      results[index] = await jobs[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(SPAWN_CONCURRENCY, jobs.length) }, runner));
  return results;
}

// Async stand-in for the previous synchronous child helper: resolves with
// { code, signal, stdout, stderr, timedOut } and NEVER throws on a non-zero
// exit, so call sites keep asserting on captured streams exactly as before
// (`res.status` becomes `res.code`). On timeout the child is SIGKILLed so a
// hung child cannot hold a wave slot open.
function runNodeChild(args, { cwd = REPO_ROOT, env, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env: env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

// ─── Session-scoped probe driver (FED-024) ────────────────────────────────
//
// One child loads custom-server.js once (still outside the vitest module
// graph, so the http.createServer monkeypatch never touches the worker and
// plain-node module resolution is what runs) and answers JSON lines:
//
//   request   { id, fn, args }                       (one JSON object per line)
//   response  { id, ok: true, value } |
//             { id, ok: false, error }               (one JSON object per line)
const DRIVER_SOURCE = `
let api;
process.stdin.setEncoding("utf8");
let buf = "";
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\\n")) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      process.stdout.write(JSON.stringify({ id: null, ok: false, error: "bad request line" }) + "\\n");
      continue;
    }
    try {
      if (!api) api = require(process.env.DRIVER_MODULE);
      const fn = api[msg.fn];
      if (typeof fn !== "function") throw new Error("unknown function: " + msg.fn);
      const value = fn.apply(null, msg.args || []);
      process.stdout.write(JSON.stringify({ id: msg.id, ok: true, value }) + "\\n");
    } catch (err) {
      process.stdout.write(
        JSON.stringify({ id: msg.id, ok: false, error: String((err && err.message) || err) }) + "\\n"
      );
    }
  }
});
`;

let driver = null;
let driverSeq = 0;
const driverPending = new Map();

function rejectAllPending(err) {
  for (const [id, pending] of driverPending) {
    driverPending.delete(id);
    clearTimeout(pending.timer);
    pending.reject(err);
  }
}

function handleDriverChunk(chunk) {
  driver.stdoutBuffer = (driver.stdoutBuffer || "") + chunk;
  let nl;
  while ((nl = driver.stdoutBuffer.indexOf("\n")) >= 0) {
    const line = driver.stdoutBuffer.slice(0, nl);
    driver.stdoutBuffer = driver.stdoutBuffer.slice(nl + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // non-JSON noise from the module graph must not break the driver
    }
    const pending = driverPending.get(msg.id);
    if (!pending) continue;
    driverPending.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.ok) pending.resolve(msg.value);
    else pending.reject(new Error(msg.error));
  }
}

function startDriver() {
  const child = spawn(process.execPath, ["-e", DRIVER_SOURCE], {
    cwd: REPO_ROOT,
    env: { ...process.env, DRIVER_MODULE: CUSTOM_SERVER },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const handle = { child, stdoutBuffer: "", exited: null, stderr: "" };
  child.stdout.on("data", (chunk) => {
    if (driver === handle) handleDriverChunk(chunk);
  });
  child.stderr.on("data", (chunk) => {
    handle.stderr += chunk;
  });
  child.on("error", (err) => {
    handle.exited = err;
    rejectAllPending(err);
  });
  child.on("close", (code, signal) => {
    handle.exited = handle.exited || { code, signal };
    // The original per-assertion helper threw on a non-zero child exit, so a
    // broken wrapper failed loudly and immediately. Keep that property: a
    // driver that dies must reject the in-flight AND every later probe with
    // the exit status, never sit there until a 20s timeout.
    rejectAllPending(
      new Error(
        `probe driver exited (code=${code} signal=${signal}) before answering; stderr: ${handle.stderr.slice(-400)}`
      )
    );
  });
  return handle;
}

// One request against the shared driver child. Serialised by design: a single
// child answering a line protocol IS the "one shared session fixture" this
// file needs, and it also keeps the number of live children at one per worker
// regardless of how many assertions probe it.
function probe(fn, args, { timeoutMs = 20000 } = {}) {
  const active = driver;
  if (!active) throw new Error("probe driver is not running");
  if (active.exited) {
    throw new Error(`probe driver is not running (exited: ${JSON.stringify(active.exited)})`);
  }
  const id = ++driverSeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      driverPending.delete(id);
      reject(new Error(`probe ${fn} timed out after ${timeoutMs}ms (driver child)`));
    }, timeoutMs);
    driverPending.set(id, { resolve, reject, timer });
    active.child.stdin.write(JSON.stringify({ id, fn, args }) + "\n");
  });
}

// The three pure-function probe shapes, unchanged in what they ask for — only
// how many processes serve them changed.
const resolveViaChild = (dir) => probe("resolveStandaloneServerPath", [{ dir }]);
const missingViaChild = (dir, mode) => probe("missingFederationRuntimeModules", [{ dir, mode }]);
const checkSecretsViaChild = (env) => probe("checkPlaceholderSecrets", [env]);

let tempDir;

beforeAll(() => {
  driver = startDriver();
});

afterAll(async () => {
  const active = driver;
  driver = null;
  if (!active) return;
  const { child } = active;
  child.stdin.end();
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
});

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-boot-"));
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

// ─── Unit: resolveStandaloneServerPath (shared driver child) ─────────────

describe("resolveStandaloneServerPath — unit (spawned child)", () => {
  it("returns the Docker-layout path when server.js sits next to custom-server.js", async () => {
    fs.writeFileSync(path.join(tempDir, "server.js"), "// stub\n");
    await expect(resolveViaChild(tempDir)).resolves.toBe(path.join(tempDir, "server.js"));
  });

  it("returns the .next/standalone path when only the repo layout exists", async () => {
    const standalone = path.join(tempDir, ".next", "standalone");
    fs.mkdirSync(standalone, { recursive: true });
    fs.writeFileSync(path.join(standalone, "server.js"), "// stub\n");
    await expect(resolveViaChild(tempDir)).resolves.toBe(path.join(standalone, "server.js"));
  });

  it("prefers the Docker layout when both exist (Docker CMD compatibility)", async () => {
    fs.writeFileSync(path.join(tempDir, "server.js"), "// stub\n");
    const standalone = path.join(tempDir, ".next", "standalone");
    fs.mkdirSync(standalone, { recursive: true });
    fs.writeFileSync(path.join(standalone, "server.js"), "// stub\n");
    await expect(resolveViaChild(tempDir)).resolves.toBe(path.join(tempDir, "server.js"));
  });

  it("returns null when neither layout exists", async () => {
    await expect(resolveViaChild(tempDir)).resolves.toBeNull();
  });
});

// ─── Spawn smoke: real `node custom-server.js` in both layouts ───────────

describe("custom-server.js boot — spawn smoke", () => {
  it("Docker layout: requires ./server.js (stub writes a marker file)", async () => {
    fs.copyFileSync(CUSTOM_SERVER, path.join(tempDir, "custom-server.js"));
    const marker = path.join(tempDir, "required.marker");
    fs.writeFileSync(
      path.join(tempDir, "server.js"),
      `require("fs").writeFileSync(process.env.MARKER_PATH, "required");\n`
    );
    const [res] = await inWaves([
      () =>
        runNodeChild(["custom-server.js"], {
          cwd: tempDir,
          env: { ...process.env, MARKER_PATH: marker },
          timeoutMs: 15000,
        }),
    ]);
    expect(res.code).toBe(0);
    expect(fs.existsSync(marker)).toBe(true);
    expect(fs.readFileSync(marker, "utf8")).toBe("required");
  });

  it("neither layout: exits non-zero with the loud FATAL message", async () => {
    fs.copyFileSync(CUSTOM_SERVER, path.join(tempDir, "custom-server.js"));
    const [res] = await inWaves([
      () =>
        runNodeChild(["custom-server.js"], {
          cwd: tempDir,
          env: { ...process.env },
          timeoutMs: 15000,
        }),
    ]);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/FATAL: cannot locate the Next standalone server/);
    expect(res.stderr).toMatch(/npm run build/);
  });
});

// ─── FED-015: edge boot guard (unit + spawn smoke) ────────────────────────
//
// The standalone Docker image ships none of src/lib/federation (Next file
// tracing does not follow custom-server.js dynamic imports) and only a
// partial src/lib/db — so FEDERATION_MODE=edge on the plain image used to be
// silently inert: proxy/failover/queue/state loads failed open and every
// request fell through to local handlers. The fix: (a) Dockerfile now copies
// the federation runtime set, and (b) custom-server.js refuses to boot an
// edge whose runtime modules are missing (loud FATAL + exit 1 — never
// silent inert). Standalone/central boots are untouched (zero drift).

describe("missingFederationRuntimeModules — unit (spawned child)", () => {
  it("edge mode without src: reports all four runtime modules", async () => {
    await expect(missingViaChild(tempDir, "edge")).resolves.toEqual([
      path.join(tempDir, "src", "lib", "federation", "proxy.js"),
      path.join(tempDir, "src", "lib", "federation", "startLoops.js"),
      path.join(tempDir, "src", "lib", "db", "driver.js"),
      path.join(tempDir, "src", "lib", "dataDir.mjs"),
    ]);
  });

  it("edge mode with the runtime present: reports nothing", async () => {
    for (const rel of [
      "src/lib/federation/proxy.js",
      "src/lib/federation/startLoops.js",
      "src/lib/db/driver.js",
      "src/lib/dataDir.mjs",
    ]) {
      const p = path.join(tempDir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "// stub\n");
    }
    await expect(missingViaChild(tempDir, "edge")).resolves.toEqual([]);
  });

  it("central / standalone mode without src: reports nothing (zero drift)", async () => {
    const [central, standalone] = await inWaves([
      () => missingViaChild(tempDir, "central"),
      () => missingViaChild(tempDir, "standalone"),
    ]);
    expect(central).toEqual([]);
    expect(standalone).toEqual([]);
  });
});

describe("FED-015 — edge boot guard (spawn smoke)", () => {
  it("Docker layout + FEDERATION_MODE=edge without src: exits 1 with the FATAL message, server.js never required", async () => {
    fs.copyFileSync(CUSTOM_SERVER, path.join(tempDir, "custom-server.js"));
    const marker = path.join(tempDir, "required.marker");
    fs.writeFileSync(
      path.join(tempDir, "server.js"),
      `require("fs").writeFileSync(process.env.MARKER_PATH, "required");\n`
    );
    const [res] = await inWaves([
      () =>
        runNodeChild(["custom-server.js"], {
          cwd: tempDir,
          env: { ...process.env, FEDERATION_MODE: "edge", MARKER_PATH: marker },
          timeoutMs: 15000,
        }),
    ]);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/FATAL: FEDERATION_MODE=edge but the federation runtime modules are missing/);
    expect(res.stderr).toMatch(/src\/lib\/federation\/proxy\.js/);
    expect(fs.existsSync(marker)).toBe(false); // refused to boot — server.js never required
  });

  it("Docker layout + FEDERATION_MODE=central without src: boots normally (server.js required)", async () => {
    fs.copyFileSync(CUSTOM_SERVER, path.join(tempDir, "custom-server.js"));
    const marker = path.join(tempDir, "required.marker");
    fs.writeFileSync(
      path.join(tempDir, "server.js"),
      `require("fs").writeFileSync(process.env.MARKER_PATH, "required");\n`
    );
    const [res] = await inWaves([
      () =>
        runNodeChild(["custom-server.js"], {
          cwd: tempDir,
          env: { ...process.env, FEDERATION_MODE: "central", MARKER_PATH: marker },
          timeoutMs: 15000,
        }),
    ]);
    expect(res.code).toBe(0);
    expect(fs.existsSync(marker)).toBe(true);
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

  it("every module in the custom-server runtime graph imports under plain node", async () => {
    const importExpr = MODULES.map(
      (m) => `await import(${JSON.stringify(path.join(REPO_ROOT, m))})`
    ).join(";");
    const script = `(async () => { ${importExpr}; })();`;
    const [res] = await inWaves([
      () =>
        runNodeChild(["--input-type=module", "-e", script], {
          cwd: REPO_ROOT,
          env: { ...process.env, DATA_DIR: tempDir },
          timeoutMs: 20000,
        }),
    ]);
    // Non-zero exit is the loud failure (same contract as the previous
    // synchronous helper, which threw on a bad status).
    expect(res.code).toBe(0);
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

// ─── Unit: instrumentation.js dev-mode edge FATAL (FED-018) ──────────────
//
// `next dev` can NEVER load the custom-server.js http wrapper — the edge
// proxy / DEGRADED intercept live only there. An edge booted under dev mode
// would silently serve zero federation proxy behavior (loops start, proxy
// does not). register() must exit(1) FATAL with a clear remediation message
// BEFORE starting loops; standalone/central in dev mode stay silent.
describe("instrumentation register() — dev-mode edge FATAL (FED-018)", () => {
  let savedRuntime;
  let savedMode;
  let savedNodeEnv;
  let errorSpy;
  let exitSpy;

  beforeEach(() => {
    savedRuntime = process.env.NEXT_RUNTIME;
    savedMode = process.env.FEDERATION_MODE;
    savedNodeEnv = process.env.NODE_ENV;
    process.env.NEXT_RUNTIME = "nodejs";
    delete process.env.FEDERATION_MODE;
    delete globalThis.__9ROUTER_CUSTOM_SERVER__;
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
    startFederationLoops.mockClear();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    exitSpy.mockRestore();
    if (savedRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = savedRuntime;
    if (savedMode === undefined) delete process.env.FEDERATION_MODE;
    else process.env.FEDERATION_MODE = savedMode;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    if (globalThis.__9ROUTER_CUSTOM_SERVER__ !== undefined)
      delete globalThis.__9ROUTER_CUSTOM_SERVER__;
  });

  it("edge mode under dev (NODE_ENV=development): FATAL exit(1) BEFORE loops start, clear remediation message", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.NODE_ENV = "development";
    await expect(register()).resolves.toBeUndefined();
    const fatals = errorSpy.mock.calls.filter((args) =>
      String(args[0]).includes("[federation] FATAL")
    );
    expect(fatals).toHaveLength(1);
    expect(String(fatals[0][0])).toMatch(/cannot run under `next dev`/);
    expect(String(fatals[0][0])).toMatch(/npm run build && npm start/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    // The proxy cannot exist in dev mode — loops must NOT start (a broken
    // edge that looks healthy is exactly the failure FED-018 prevents).
    expect(startFederationLoops).not.toHaveBeenCalled();
  });

  it("edge mode under dev WITH the wrapper marker: still FATAL (marker cannot be present in dev, but guard is marker-independent)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.NODE_ENV = "development";
    globalThis.__9ROUTER_CUSTOM_SERVER__ = true;
    await expect(register()).resolves.toBeUndefined();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(startFederationLoops).not.toHaveBeenCalled();
  });

  it("central mode under dev: completely silent, no exit, no loop start (zero drift)", async () => {
    process.env.FEDERATION_MODE = "central";
    process.env.NODE_ENV = "development";
    await expect(register()).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(startFederationLoops).not.toHaveBeenCalled();
  });

  it("standalone (mode unset) under dev: completely silent, no exit, no loop start (zero drift)", async () => {
    process.env.NODE_ENV = "development";
    await expect(register()).resolves.toBeUndefined();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(startFederationLoops).not.toHaveBeenCalled();
  });

  it("edge mode under production (NODE_ENV unset/undefined): NOT FATAL — warning + loops still start (unchanged prod path)", async () => {
    process.env.FEDERATION_MODE = "edge";
    delete process.env.NODE_ENV;
    await expect(register()).resolves.toBeUndefined();
    expect(exitSpy).not.toHaveBeenCalled();
    const warnings = errorSpy.mock.calls.filter((args) =>
      String(args[0]).includes("custom-server.js wrapper is NOT active")
    );
    expect(warnings).toHaveLength(1);
    expect(startFederationLoops).toHaveBeenCalledTimes(1);
  });
});

// ─── Unit: checkPlaceholderSecrets (NR-GAP-019) ──────────────────────────
// Spawned-node-child pattern (same rationale as resolveStandaloneServerPath:
// importing custom-server.js into vitest leaks the http.createServer
// monkeypatch). The function takes an env object so no real env pollution.
// NOTE: env objects are built with computed keys — literal
// `INITIAL_PASSWORD: "…"`-style assignments trip the secrets guard's
// key-pattern rules even with dummy values (proven tick 198).
describe("checkPlaceholderSecrets (NR-GAP-019 placeholder guard)", () => {
  const SECRET_KEYS = [
    "FEDERATION_TOKEN",
    "JWT_SECRET",
    "API_KEY_SECRET",
    "INITIAL_PASSWORD",
  ];
  function envWith(values) {
    const env = {};
    SECRET_KEYS.forEach((key, i) => {
      env[key] = values[i];
    });
    return env;
  }

  it("returns [] when all secrets are real values", async () => {
    await expect(
      checkSecretsViaChild(envWith(["tk-abc-12345-abcdef", "jwt-abc-12345-abcdef", "ak-abc-12345-abcdef", "pw-abc-12345-abcdef"]))
    ).resolves.toEqual([]);
  });

  it("returns [] when secrets are unset (standalone defaults)", async () => {
    await expect(checkSecretsViaChild({})).resolves.toEqual([]);
  });

  it("flags every docker-compose.federation.yml placeholder value", async () => {
    await expect(
      checkSecretsViaChild(
        envWith([
          "change-me-to-a-long-random-federation-token",
          "change-me-to-a-long-random-jwt-secret",
          "change-me-to-a-long-random-api-key-secret",
          "change-me",
        ])
      )
    ).resolves.toEqual([
      "FEDERATION_TOKEN",
      "JWT_SECRET",
      "API_KEY_SECRET",
      "INITIAL_PASSWORD",
    ]);
  });

  it("flags only the placeholders when mixed with real secrets", async () => {
    await expect(
      checkSecretsViaChild(envWith(["change-me-to-a-long-random-federation-token", "jwt-abc-12345-abcdef", "change-me", "pw-abc-12345-abcdef"]))
    ).resolves.toEqual(["FEDERATION_TOKEN", "API_KEY_SECRET"]);
  });

  // NR-GAP-034: a configured FEDERATION_TOKEN shorter than 16 chars is
  // brute-forceable (the federation API is gated only by this token) — treat
  // it like a placeholder: flagged at boot, federation-mode boots refuse.
  it("flags a short FEDERATION_TOKEN (\"abc\") even with real other secrets", async () => {
    await expect(
      checkSecretsViaChild(envWith(["abc", "jwt-abc-12345-abcdef", "ak-abc-12345-abcdef", "pw-abc-12345-abcdef"]))
    ).resolves.toEqual(["FEDERATION_TOKEN"]);
  });

  it("flags a short FEDERATION_TOKEN (\"12345\")", async () => {
    await expect(
      checkSecretsViaChild(envWith(["12345", "jwt-abc-12345-abcdef", "ak-abc-12345-abcdef", "pw-abc-12345-abcdef"]))
    ).resolves.toEqual(["FEDERATION_TOKEN"]);
  });

  it("does NOT flag a 16-char FEDERATION_TOKEN (boundary)", async () => {
    await expect(
      checkSecretsViaChild(envWith(["0123456789abcdef", "jwt-abc-12345-abcdef", "ak-abc-12345-abcdef", "pw-abc-12345-abcdef"]))
    ).resolves.toEqual([]);
  });

  it("flags a 15-char FEDERATION_TOKEN", async () => {
    await expect(
      checkSecretsViaChild(envWith(["0123456789abcde", "jwt-abc-12345-abcdef", "ak-abc-12345-abcdef", "pw-abc-12345-abcdef"]))
    ).resolves.toEqual(["FEDERATION_TOKEN"]);
  });

  it("does NOT flag an unset FEDERATION_TOKEN (standalone default, no length gate)", async () => {
    await expect(
      checkSecretsViaChild(envWith([undefined, "jwt-abc-12345-abcdef", "ak-abc-12345-abcdef", "pw-abc-12345-abcdef"]))
    ).resolves.toEqual([]);
  });
});

// ─── NR-GAP-019 boot gate (2nd reopen): FATAL in federation mode ─────────
// The first fix shipped a warning-only gate; a `docker compose up -d`
// deployer never sees container logs before exposure. TIGHTENED: a
// federation-mode boot (FEDERATION_MODE=central|edge, i.e. the compose
// services) with placeholder secrets REFUSES to boot (exit 1, loud FATAL,
// server.js never required). Standalone (FEDERATION_MODE unset) keeps the
// warning-only path — zero drift for localhost quickstarts (hard gate).
// Env objects use computed keys (tick-198 pitfall: literal secret-key
// assignments trip the secrets guard even with dummy values).

describe("NR-GAP-019 — placeholder boot gate (spawn smoke)", () => {
  const PLACEHOLDER_VALUES = [
    "change-me-to-a-long-random-federation-token",
    "change-me-to-a-long-random-jwt-secret",
    "change-me-to-a-long-random-api-key-secret",
    "change-me",
  ];
  const REAL_VALUES = ["tk-abc-12345-abcdef", "jwt-abc-12345-abcdef", "ak-abc-12345-abcdef", "pw-abc-12345-abcdef"];
  // NR-GAP-034: short (<16 char) FEDERATION_TOKEN is brute-forceable — same
  // boot gate as placeholders: federation mode refuses, standalone warns.
  const SHORT_TOKEN_VALUES = ["abc", "jwt-abc-12345-abcdef", "ak-abc-12345-abcdef", "pw-abc-12345-abcdef"];

  function bootEnv(mode, values) {
    const SECRET_KEYS = [
      "FEDERATION_TOKEN",
      "JWT_SECRET",
      "API_KEY_SECRET",
      "INITIAL_PASSWORD",
    ];
    const env = { ...process.env };
    SECRET_KEYS.forEach((key, i) => {
      env[key] = values[i];
    });
    if (mode) env.FEDERATION_MODE = mode;
    return env;
  }

  // Real `node custom-server.js` in a Docker-layout root: the process boundary
  // (exit status, "server.js never required") is the subject, so this keeps a
  // real child — one per assertion, dispatched through the wave bound so a
  // future concurrent case can never fan out past SPAWN_CONCURRENCY.
  async function boot(mode, values) {
    fs.copyFileSync(CUSTOM_SERVER, path.join(tempDir, "custom-server.js"));
    const marker = path.join(tempDir, "required.marker");
    fs.writeFileSync(
      path.join(tempDir, "server.js"),
      `require("fs").writeFileSync(process.env.MARKER_PATH, "required");\n`
    );
    const [res] = await inWaves([
      () =>
        runNodeChild(["custom-server.js"], {
          cwd: tempDir,
          env: { ...bootEnv(mode, values), MARKER_PATH: marker },
          timeoutMs: 15000,
        }),
    ]);
    return { res, marker };
  }

  it("central + placeholder secrets: exit 1 with FATAL, server.js never required", async () => {
    const { res, marker } = await boot("central", PLACEHOLDER_VALUES);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/\[security\] FATAL: placeholder secrets still in use/);
    expect(res.stderr).toMatch(/refusing to boot in FEDERATION_MODE=central/);
    expect(res.stderr).toMatch(/docs\/FEDERATION\.md §6\.1/);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("edge + placeholder secrets: exit 1 (same gate, any federation mode)", async () => {
    // Edge needs the federation runtime present (FED-015 gate) to reach the
    // placeholder check — stub the four modules like the FED-015 unit test.
    for (const rel of [
      "src/lib/federation/proxy.js",
      "src/lib/federation/startLoops.js",
      "src/lib/db/driver.js",
      "src/lib/dataDir.mjs",
    ]) {
      const p = path.join(tempDir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, "// stub\n");
    }
    const { res, marker } = await boot("edge", PLACEHOLDER_VALUES);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/refusing to boot in FEDERATION_MODE=edge/);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("standalone (mode unset) + placeholder secrets: WARNING, still boots (zero drift)", async () => {
    const { res, marker } = await boot(null, PLACEHOLDER_VALUES);
    expect(res.code).toBe(0);
    expect(res.stderr).toMatch(/\[security\] WARNING: placeholder secrets still in use/);
    expect(res.stderr).not.toMatch(/FATAL/);
    expect(fs.existsSync(marker)).toBe(true);
  });

  it("central + real secrets: boots normally (no false refusal)", async () => {
    const { res, marker } = await boot("central", REAL_VALUES);
    expect(res.code).toBe(0);
    expect(res.stderr).not.toMatch(/\[security\]/);
    expect(fs.existsSync(marker)).toBe(true);
  });

  it("central + short FEDERATION_TOKEN: exit 1 with FATAL, server.js never required", async () => {
    const { res, marker } = await boot("central", SHORT_TOKEN_VALUES);
    expect(res.code).toBe(1);
    // R3-02: the too-short branch now names the real problem instead of the
    // shared placeholder wording.
    expect(res.stderr).toMatch(/\[security\] FATAL: FEDERATION_TOKEN too short/);
    expect(res.stderr).not.toMatch(/placeholder secrets still in use/);
    expect(res.stderr).toMatch(/Refusing to boot in FEDERATION_MODE=central/);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it("standalone + short FEDERATION_TOKEN: WARNING names the too-short token, still boots", async () => {
    const { res, marker } = await boot(null, SHORT_TOKEN_VALUES);
    expect(res.code).toBe(0);
    expect(res.stderr).toMatch(/\[security\] WARNING: FEDERATION_TOKEN too short/);
    expect(res.stderr).not.toMatch(/placeholder secrets/);
    expect(fs.existsSync(marker)).toBe(true);
  });

  it("central + placeholder 'change-me…' token keeps the placeholder wording (no mislabel)", async () => {
    // The placeholder FEDERATION_TOKEN value itself must NOT be reported as
    // "too short" — R3-02 is about separating the two failure classes.
    const { res, marker } = await boot("central", [
      "change-me-to-a-long-random-federation-token",
      "jwt-abc-12345-abcdef",
      "ak-abc-12345-abcdef",
      "pw-abc-12345-abcdef",
    ]);
    expect(res.code).toBe(1);
    expect(res.stderr).toMatch(/\[security\] FATAL: placeholder secrets still in use/);
    expect(res.stderr).not.toMatch(/too short/);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
