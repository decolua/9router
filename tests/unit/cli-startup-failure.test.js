/**
 * DF-9ROUTER-18 — CLI reports success when startup has failed.
 *
 * The published launcher (cli/cli.js) used to decide "server is ready" from a
 * bare TCP connect to 127.0.0.1:<port>. ANY listener satisfied it, and the
 * spawned child was never watched in tray/background mode — so with the port
 * already held (foreign server, docker-published port, stale instance) the CLI
 * printed "Router is now running in system tray" and exited 0 while its own
 * child died with EADDRINUSE. Beyond the launcher, automation and users see a
 * healthy start where the server never bound.
 *
 * Coverage, in two layers:
 *
 *  1. UNIT — cli/src/cli/utils/serverStartup.js driven directly with real
 *     sockets (dummy TCP listener, non-9router HTTP server, 9router-shaped
 *     /api/health server) and fake child EventEmitters:
 *       - a free port is usable; an occupied port is refused and the refusal
 *         names EADDRINUSE (both the foreign and the existing-9router case)
 *       - readiness requires the child to be ALIVE and the identity probe to
 *         answer, so a dying child can never be masked by a foreign listener
 *       - child exit / spawn error / timeout are reported as failures
 *
 *  2. SPAWN E2E — the REAL cli/cli.js, run from a temp CLI root whose
 *     cli/app/server.js stub stands in for the Next standalone server (boot
 *     success, or an EADDRINUSE death):
 *       - occupied port  → exit non-zero, no readiness claim, child NEVER spawned
 *       - child failure  → exit non-zero with a clear diagnostic
 *       - healthy start  → readiness message, child really bound the port,
 *                          process still alive (unchanged happy path)
 *
 * Hermetic spawn: PATH stubs for `ps`/`lsof`/`npm`. The launcher's best-effort
 * cleanup (killAllAppProcesses / killProcessOnPort) otherwise runs against the
 * real machine — it would kill unrelated `next-server` processes and free the
 * occupied port, which is exactly the state this defect is about. `npm` is
 * stubbed so the runtime self-heal never touches the network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  checkPortAvailable,
  describeOccupiedPort,
  describeStartupFailure,
  is9routerHealthBody,
  waitForServerReady,
} = require("../../cli/src/cli/utils/serverStartup.js");

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const READY_LINE = "Router is now running in system tray";
const UNIT_TIMEOUT = 20000;
const SPAWN_TIMEOUT = 60000;

// ─── helpers ────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function listen(server, host = "127.0.0.1") {
  return new Promise((resolve) => {
    server.listen(0, host, () => resolve(server.address().port));
  });
}

const closeServer = (entry) =>
  new Promise((resolve) => {
    const server = entry && entry.server ? entry.server : entry;
    // Probes leave (and abruptly drop) connections; without this, close() waits
    // for them and the afterEach hook times out.
    if (entry && typeof entry.destroy === "function") entry.destroy();
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    server.close(() => resolve());
  });

// Real HTTP server shaped like 9router's /api/health ({"ok":true}).
function start9routerShape() {
  const server = http.createServer((req, res) => {
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  return listen(server).then((port) => ({ server, port }));
}

// A live listener that is NOT a 9router server: it accepts connections and never
// answers (no HTTP response, no EOF). Sockets are resumed so an incoming FIN is
// consumed — a paused socket keeps the server alive and close() would hang.
function startDummyListener() {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.resume();
  });
  return listen(server).then((port) => ({
    server,
    port,
    destroy: () => {
      for (const socket of sockets) socket.destroy();
    },
  }));
}

function pickFreePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// ChildProcess-shaped double: exitCode/signalCode start null ("alive") and the
// 'exit' event is emitted the way node does it.
class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.exitCode = null;
    this.signalCode = null;
  }
  exit(code) {
    this.exitCode = code;
    this.emit("exit", code, null);
  }
  die(signal) {
    this.signalCode = signal;
    this.emit("exit", null, signal);
  }
}

// ─── unit: port pre-flight ──────────────────────────────────────────────────

describe("DF-9ROUTER-18 checkPortAvailable — occupied ports are refused", () => {
  let closers;

  beforeEach(() => {
    closers = [];
  });

  afterEach(async () => {
    for (const server of closers.splice(0)) await closeServer(server);
  });

  it("accepts a free port", async () => {
    const port = await pickFreePort();
    await expect(checkPortAvailable({ port })).resolves.toMatchObject({
      ok: true,
      free: true,
      occupied: false,
    });
  });

  it("refuses a port held by a non-9router listener and names EADDRINUSE", async () => {
    const dummy = await startDummyListener();
    closers.push(dummy);
    const { port } = dummy;

    const state = await checkPortAvailable({ port });
    expect(state.ok).toBe(false);
    expect(state.occupied).toBe(true);
    expect(state.identified).toBe(false);

    const message = describeOccupiedPort(port, state);
    expect(message).toMatch(/EADDRINUSE/);
    expect(message).toMatch(new RegExp(`Port ${port}`));
    expect(message).toMatch(/another process/);
    expect(message).not.toMatch(/running in system tray/);
  });

  it("refuses a port held by a non-9router HTTP server (404 answer)", async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(404);
      res.end("nope");
    });
    const port = await listen(server);
    closers.push(server);

    const state = await checkPortAvailable({ port });
    expect(state).toMatchObject({ ok: false, occupied: true, identified: false });
  });

  it("refuses a port held by an existing 9router server (identity probe answers)", async () => {
    const { server, port } = await start9routerShape();
    closers.push(server);

    const state = await checkPortAvailable({ port });
    expect(state).toMatchObject({ ok: false, occupied: true, identified: true });

    const message = describeOccupiedPort(port, state);
    expect(message).toMatch(/EADDRINUSE/);
    expect(message).toMatch(/existing 9router server/);
  });

  it("treats only {\"ok\":true} as the 9router health signature", () => {
    expect(is9routerHealthBody('{"ok":true}')).toBe(true);
    expect(is9routerHealthBody('{"ok":false}')).toBe(false);
    expect(is9routerHealthBody('{"healthy":true}')).toBe(false);
    expect(is9routerHealthBody("<html>hello</html>")).toBe(false);
  });
});

// ─── unit: readiness / child failure ────────────────────────────────────────

describe("DF-9ROUTER-18 waitForServerReady — our child must be the one serving", () => {
  let closers;

  beforeEach(() => {
    closers = [];
  });

  afterEach(async () => {
    for (const server of closers.splice(0)) await closeServer(server);
  });

  it("is ready when the child is alive and the identity probe answers", async () => {
    const { server, port } = await start9routerShape();
    closers.push(server);
    const child = new FakeChild();

    await expect(waitForServerReady({ port, child, timeoutMs: 5000 })).resolves.toEqual({ ok: true });
  });

  it("fails fast when the child exits non-zero before the server answers", async () => {
    const port = await pickFreePort();
    const child = new FakeChild();

    const started = Date.now();
    const pending = waitForServerReady({ port, child, timeoutMs: 10000, intervalMs: 50 });
    await delay(60);
    child.exit(1);

    const result = await pending;
    expect(result).toMatchObject({ ok: false, reason: "child-exit", code: 1 });
    expect(Date.now() - started).toBeLessThan(5000);

    const message = describeStartupFailure(port, result);
    expect(message).toMatch(/Server failed to start/);
    expect(message).toMatch(/exit code 1/);
    expect(message).toMatch(/EADDRINUSE/); // named as the usual cause
  });

  it("does not read a foreign listener as ready when our child died mid-probe", async () => {
    // The probe is in flight (real world: a dying child whose port is owned by
    // someone else) — the answer must still be the child's failure.
    const { server, port } = await start9routerShape();
    closers.push(server);
    const child = new FakeChild();

    let releaseProbe;
    const probeStarted = new Promise((resolve) => {
      releaseProbe = resolve;
    });
    const probe = async () => {
      releaseProbe();
      await delay(250);
      return { reachable: true, identified: true, status: 200 };
    };

    const pending = waitForServerReady({ port, child, timeoutMs: 10000, probe });
    await probeStarted;
    child.exit(1);

    await expect(pending).resolves.toMatchObject({ ok: false, reason: "child-exit", code: 1 });
  });

  it("fails immediately when the child is already dead, even though a 9router answers", async () => {
    // The exact regression: a stale/foreign 9router serving the port while OUR
    // child is gone must not be reported as a healthy start.
    const { server, port } = await start9routerShape();
    closers.push(server);
    const child = new FakeChild();
    child.exitCode = 1;

    const result = await waitForServerReady({ port, child, timeoutMs: 5000 });
    expect(result).toMatchObject({ ok: false, reason: "child-exit", code: 1 });
  });

  it("reports a spawn error (child never ran)", async () => {
    const port = await pickFreePort();
    const child = new FakeChild();
    const pending = waitForServerReady({ port, child, timeoutMs: 5000 });
    await delay(20);
    const err = new Error("spawn node ENOENT");
    child.emit("error", err);

    const result = await pending;
    expect(result).toMatchObject({ ok: false, reason: "child-error", error: "spawn node ENOENT" });
    expect(describeStartupFailure(port, result)).toMatch(/ENOENT/);
  });

  it("reports a timeout when nothing ever answers and the child stays alive", async () => {
    const port = await pickFreePort();
    const child = new FakeChild();

    const result = await waitForServerReady({ port, child, timeoutMs: 600, intervalMs: 50 });
    expect(result).toMatchObject({ ok: false, reason: "timeout" });
    expect(describeStartupFailure(port, result)).toMatch(/did not become ready/);
  });

  it("reports a signalled child as an exit failure", async () => {
    const port = await pickFreePort();
    const child = new FakeChild();
    const pending = waitForServerReady({ port, child, timeoutMs: 5000 });
    await delay(20);
    child.die("SIGKILL");

    const result = await pending;
    expect(result).toMatchObject({ ok: false, reason: "child-exit", code: null, signal: "SIGKILL" });
    expect(describeStartupFailure(port, result)).toMatch(/SIGKILL/);
  });
});

// ─── spawn E2E: the real launcher ───────────────────────────────────────────

// Stand-in for the Next standalone server. `STUB_CHILD_MODE=fail` reproduces the
// EADDRINUSE death (same wording the real bundle prints); otherwise it binds the
// port and serves /api/health. Markers prove whether a child was spawned and
// whether it actually bound the port.
const STUB_SERVER_JS = [
  '"use strict";',
  'const fs = require("fs");',
  'const http = require("http");',
  'const port = parseInt(process.env.PORT, 10) || 0;',
  'if (process.env.STUB_CHILD_MARKER) fs.writeFileSync(process.env.STUB_CHILD_MARKER, String(port));',
  'if (process.env.STUB_CHILD_MODE === "fail") {',
  '  console.error("Error: listen EADDRINUSE: address already in use 0.0.0.0:" + port);',
  "  process.exit(1);",
  "}",
  'const server = http.createServer((req, res) => {',
  '  if (req.url === "/api/health") {',
  '    res.writeHead(200, { "content-type": "application/json" });',
  '    res.end(\'{"ok":true}\');',
  "    return;",
  "  }",
  "  res.writeHead(404);",
  '  res.end("not found");',
  "});",
  'server.listen(port, "0.0.0.0", () => {',
  '  if (process.env.STUB_BOUND_MARKER) fs.writeFileSync(process.env.STUB_BOUND_MARKER, String(port));',
  "});",
  "",
].join("\n");

function makeCliRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cli-df349-"));
  for (const rel of ["cli.js", "package.json", "hooks", "src"]) {
    fs.cpSync(path.join(REPO_ROOT, "cli", rel), path.join(root, rel), { recursive: true });
  }
  const appDir = path.join(root, "app");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, "server.js"), STUB_SERVER_JS);

  // PATH stubs: keep the run hermetic and keep the occupied listener alive.
  const binDir = path.join(root, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const stubs = {
    ps: "#!/bin/sh\nexit 0\n",
    lsof: "#!/bin/sh\nexit 0\n",
    npm: "#!/bin/sh\necho 'stub npm: installs disabled in tests' >&2\nexit 1\n",
  };
  for (const [name, body] of Object.entries(stubs)) {
    fs.writeFileSync(path.join(binDir, name), body, { mode: 0o755 });
  }

  fs.mkdirSync(path.join(root, "home"), { recursive: true });
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  return {
    root,
    binDir,
    startedMarker: path.join(root, "child-started.marker"),
    boundMarker: path.join(root, "child-bound.marker"),
    appDir,
  };
}

function spawnCli(cli, args, { childMode = "serve" } = {}) {
  const env = { ...process.env };
  delete env.DISPLAY; // headless: no system tray init
  env.PATH = `${cli.binDir}${path.delimiter}${process.env.PATH || ""}`;
  env.HOME = path.join(cli.root, "home");
  env.DATA_DIR = path.join(cli.root, "data");
  env.STUB_CHILD_MODE = childMode;
  env.STUB_CHILD_MARKER = cli.startedMarker;
  env.STUB_BOUND_MARKER = cli.boundMarker;

  const proc = spawn(process.execPath, [path.join(cli.root, "cli.js"), ...args], {
    cwd: cli.root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const captured = { stdout: "", stderr: "" };
  proc.stdout.on("data", (chunk) => (captured.stdout += chunk.toString()));
  proc.stderr.on("data", (chunk) => (captured.stderr += chunk.toString()));
  return { proc, captured };
}

function waitForExit(proc, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    proc.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForOutput(captured, needle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (`${captured.stdout}${captured.stderr}`.includes(needle)) return true;
    await delay(100);
  }
  return false;
}

describe("DF-9ROUTER-18 CLI launcher — startup failures propagate", () => {
  let cliRoots = [];
  let liveProcs = [];
  let occupied = [];

  beforeEach(() => {
    cliRoots = [];
    liveProcs = [];
    occupied = [];
  });

  afterEach(async () => {
    for (const proc of liveProcs.splice(0)) {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGKILL");
        await waitForExit(proc, 5000);
      }
    }
    for (const server of occupied.splice(0)) await closeServer(server);
    for (const root of cliRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  });

  it(
    "occupied port: refuses, exits non-zero, never spawns a child, never claims ready",
    async () => {
      const cli = makeCliRoot();
      cliRoots.push(cli.root);
      const dummy = await startDummyListener();
      occupied.push(dummy);
      const { port } = dummy;

      const { proc, captured } = spawnCli(cli, ["-t", "--skip-update", "-p", String(port)]);
      liveProcs.push(proc);
      const exit = await waitForExit(proc, SPAWN_TIMEOUT);

      expect(exit).not.toBeNull();
      expect(exit.code).not.toBe(0);
      expect(captured.stderr).toMatch(/EADDRINUSE/);
      expect(captured.stderr).toMatch(new RegExp(`Port ${port}`));
      expect(captured.stderr).toMatch(/already in use/);
      expect(captured.stdout).not.toMatch(new RegExp(READY_LINE));
      expect(captured.stdout).not.toMatch(/🚀/); // banner only prints once we spawn
      // The pre-flight refusal happened BEFORE any child process was created.
      expect(fs.existsSync(cli.startedMarker)).toBe(false);
      expect(fs.existsSync(cli.boundMarker)).toBe(false);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "child exits with a non-zero code before ready: exits non-zero with a diagnostic",
    async () => {
      const cli = makeCliRoot();
      cliRoots.push(cli.root);
      const port = await pickFreePort();

      const { proc, captured } = spawnCli(cli, ["-t", "--skip-update", "-p", String(port)], {
        childMode: "fail",
      });
      liveProcs.push(proc);
      const exit = await waitForExit(proc, SPAWN_TIMEOUT);

      expect(exit).not.toBeNull();
      expect(exit.code).not.toBe(0);
      expect(captured.stderr).toMatch(/Server failed to start/);
      expect(captured.stderr).toMatch(/exit code 1/);
      expect(captured.stdout).not.toMatch(new RegExp(READY_LINE));
      // The child really was spawned (this is the post-spawn path, not pre-flight).
      expect(fs.existsSync(cli.startedMarker)).toBe(true);
      expect(fs.existsSync(cli.boundMarker)).toBe(false);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "healthy start: reports ready, child bound the port, process stays alive",
    async () => {
      const cli = makeCliRoot();
      cliRoots.push(cli.root);
      const port = await pickFreePort();

      const { proc, captured } = spawnCli(cli, ["-t", "--skip-update", "-p", String(port)]);
      liveProcs.push(proc);

      const reported = await waitForOutput(captured, READY_LINE, 30000);
      expect(reported).toBe(true);
      expect(proc.exitCode).toBeNull(); // still running — the child is being served
      expect(fs.existsSync(cli.startedMarker)).toBe(true);
      expect(fs.existsSync(cli.boundMarker)).toBe(true);

      // The readiness claim is backed by OUR child serving the port.
      const health = await new Promise((resolve, reject) => {
        const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 5000 }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        });
        req.on("timeout", () => req.destroy(new Error("health probe timeout")));
        req.on("error", reject);
      });
      expect(health.status).toBe(200);
      expect(health.body).toBe('{"ok":true}');

      proc.kill("SIGTERM");
      const exit = await waitForExit(proc, 10000);
      expect(exit).not.toBeNull();
      expect(exit.code).toBe(0);
    },
    SPAWN_TIMEOUT,
  );
});
