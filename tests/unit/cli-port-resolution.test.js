/**
 * DF-9ROUTER-28 — the CLI launcher ignores `PORT`.
 *
 * `cli/cli.js` parsed `--port/-p` but seeded the port from a hardcoded
 * `DEFAULT_PORT = 20128` and never read the ambient `PORT` env var, then forced
 * `PORT: port.toString()` into the spawned child's env. So the command the README
 * documents — `PORT=20129 node cli/cli.js --skip-update --no-browser` — still
 * aimed at 20128 and died on the DF-9ROUTER-18 pre-flight refusal on any host
 * already running 9router. The remedy was undiscoverable: the help text named
 * `--port` but not `PORT`, and `describeOccupiedPort()` only suggested `--port`.
 *
 * Coverage, in two layers:
 *
 *  1. UNIT — `cli/src/cli/utils/serverStartup.js` `resolvePort()` driven directly:
 *     precedence (`--port/-p` → `PORT` → default), the validity matrix (`""`,
 *     `abc`, `0`, negatives, `>65535`, non-integers, whitespace-padded, the 1 and
 *     65535 boundaries), the invalid-PORT warning, and the `PORT` remedy text in
 *     both `describeOccupiedPort()` refusal variants.
 *
 *  2. SPAWN E2E — the REAL `cli/cli.js`, run from a temp CLI root whose
 *     `cli/app/server.js` stub stands in for the Next standalone server (it
 *     records the PORT it was handed and binds it). Assertions read the
 *     launcher's OWN output (`Server: http://localhost:<port>`) plus the stub's
 *     marker files, so "the launcher used port X" is proven by the launcher, not
 *     inferred:
 *       - `PORT=<p>`        → the child is handed p, serves p, and 20128 is
 *                             never mentioned
 *       - `--port <q>` with `PORT=<p>` → q wins
 *       - no flag, no PORT  → the default 20128 (both possible arms below)
 *       - invalid `PORT`    → warning, no crash, the default 20128
 *       - occupied port     → the pre-flight refusal names the RESOLVED port
 *                             (the env port), and no child is ever spawned
 *       - `--help`          → documents `PORT` and its precedence
 *
 * Hermetic spawn (same rules as `cli-startup-failure.test.js`): PATH stubs for
 * `ps`/`lsof`/`npm`. The launcher's best-effort cleanup otherwise runs against the
 * real machine — on this host a real 9router (`next-server`) is serving 20128 and
 * `killAllAppProcesses` explicitly whitelists `next-server`, so an unstubbed run
 * would kill live servers. `npm` is stubbed so the runtime self-heal never touches
 * the network.
 *
 * Ports: the criteria name 20129/20130, but those are exactly the ports a host
 * that already runs 9router may hold (this host serves 20128, 20129 AND 20130).
 * `preferredPort()` therefore uses the named port when it is free and otherwise a
 * dynamically free one, and every assertion is relative to the port actually
 * used — so the claim under test (the env/flag port is honoured, never the
 * hardcoded default) is asserted identically on a busy host and on a clean CI box.
 *
 * Orphan guard (REVIEW-9ROUTER-002c / item 53): the launcher spawns the stub
 * DETACHED, so a test/runner death orphans it — nine stray `9router-cli-df28-*`
 * servers piled up on this host that way. Two layers now: the stub self-exits
 * when its heartbeat marker goes stale (runner dead), and the suite's afterEach
 * reaps by recorded pid as belt-and-braces. The guard is proven by the
 * "orphan guard" test with forced-low thresholds.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PORT,
  describeOccupiedPort,
  resolvePort,
} = require("../../cli/src/cli/utils/serverStartup.js");

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const READY_LINE = "Router is now running in system tray";
const SPAWN_TIMEOUT = 60000;

// Spawn-E2E shared state: fixture roots and the heartbeat interval that keeps
// live stubs' orphan guards fed. Module-level because spawnCli() (also module
// scope) registers roots and starts the refresher.
let cliRoots = [];
let heartbeatTimer = null;

// While a spawn-style test runs, keep every live stub's heartbeat marker fresh
// so only a DEAD test run leaves an orphan for the guard to reap.
function startHeartbeats() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const root of cliRoots) {
      try {
        const now = new Date();
        fs.utimesSync(path.join(root, "child-heartbeat.marker"), now, now);
      } catch {}
    }
  }, 5000);
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

function stopHeartbeats() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const closeServer = (entry) =>
  new Promise((resolve) => {
    const server = entry && entry.server ? entry.server : entry;
    if (entry && typeof entry.destroy === "function") entry.destroy();
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    server.close(() => resolve());
  });

function pickFreePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

// Named ports from the acceptance criteria when the host has them free, a
// dynamically free port otherwise (see the header note).
async function preferredPort(preferred, { avoid = [] } = {}) {
  if (!avoid.includes(preferred) && (await isPortFree(preferred))) return preferred;
  for (let i = 0; i < 20; i++) {
    const candidate = await pickFreePort();
    if (!avoid.includes(candidate)) return candidate;
  }
  throw new Error("no free port available for the spawn test");
}

// A live listener that is NOT a 9router server: it accepts connections and never
// answers, so the pre-flight probe sees an occupied, unidentified port.
function startDummyListener() {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.resume();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: server.address().port,
        destroy: () => {
          for (const socket of sockets) socket.destroy();
        },
      });
    });
  });
}

// Stand-in for the Next standalone server: records the PORT it was handed, binds
// it, answers /api/health. `STUB_CHILD_MODE=fail` reproduces an EADDRINUSE death.
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
  'if (process.env.STUB_PID_MARKER) fs.writeFileSync(process.env.STUB_PID_MARKER, String(process.pid));',
  '// Orphan guard: a fixture server must never outlive its test run. The test',
  '// touches STUB_HEARTBEAT_MARKER every 10s; when the touches stop (runner died,',
  '// killed, or between runs) the stub exits by itself instead of serving forever',
  '// as a detached stray. Max age / check interval are overridable so the suite',
  '// can prove the self-exit in seconds instead of minutes.',
  'const HB = process.env.STUB_HEARTBEAT_MARKER;',
  'if (HB) {',
  '  const HB_MAX_MS = parseInt(process.env.STUB_HEARTBEAT_MAX_MS, 10) || 30000;',
  '  const HB_CHECK_MS = parseInt(process.env.STUB_HEARTBEAT_CHECK_MS, 10) || 10000;',
  '  let lastTouch = 0;',
  '  const timer = setInterval(() => {',
  '    let mtime = 0;',
  '    try { mtime = fs.statSync(HB).mtimeMs; } catch {}',
  '    if (mtime > lastTouch) { lastTouch = mtime; return; }',
  '    if (!mtime || Date.now() - mtime > HB_MAX_MS) { clearInterval(timer); process.exit(0); }',
  '  }, HB_CHECK_MS).unref();',
  '}',
  "",
].join("\n");

function makeCliRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cli-df28-"));
  for (const rel of ["cli.js", "package.json", "hooks", "src"]) {
    fs.cpSync(path.join(REPO_ROOT, "cli", rel), path.join(root, rel), { recursive: true });
  }
  const appDir = path.join(root, "app");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, "server.js"), STUB_SERVER_JS);
  // Seed the heartbeat marker the stub watches; startHeartbeats() refreshes its
  // mtime while the test is alive.
  fs.writeFileSync(path.join(root, "child-heartbeat.marker"), "");

  // PATH stubs: keep the run hermetic (see the header note).
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

// `port` is the ambient PORT the launcher must resolve from: pass a string to set
// it, `null` to leave it unset (the "no env override" cases).
function spawnCli(cli, args, { childMode = "serve", port = null, stubEnv = {} } = {}) {
  const env = { ...process.env };
  delete env.DISPLAY; // headless: no system tray init
  delete env.PORT;
  env.PATH = `${cli.binDir}${path.delimiter}${process.env.PATH || ""}`;
  env.HOME = path.join(cli.root, "home");
  env.DATA_DIR = path.join(cli.root, "data");
  env.STUB_CHILD_MODE = childMode;
  env.STUB_CHILD_MARKER = cli.startedMarker;
  env.STUB_BOUND_MARKER = cli.boundMarker;
  // Orphan guard (see STUB_SERVER_JS): the stub watches this file's mtime and
  // self-exits when the test stops touching it, so a fixture server can never
  // outlive its run as a detached stray (REVIEW-9ROUTER-002c / item 53).
  env.STUB_HEARTBEAT_MARKER = path.join(cli.root, "child-heartbeat.marker");
  env.STUB_PID_MARKER = path.join(cli.root, "child-pid.marker");
  Object.assign(env, stubEnv);
  if (port !== null) env.PORT = port;

  const proc = spawn(process.execPath, [path.join(cli.root, "cli.js"), ...args], {
    cwd: cli.root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  startHeartbeats();
  const captured = { stdout: "", stderr: "" };
  proc.stdout.on("data", (chunk) => (captured.stdout += chunk.toString()));
  proc.stderr.on("data", (chunk) => (captured.stderr += chunk.toString()));
  return { proc, captured, output: () => `${captured.stdout}${captured.stderr}` };
}

function waitForExit(proc, timeoutMs) {
  // An already-exited child never re-emits "exit", so its recorded status is the
  // answer — registering the listener first would wait out the whole timeout.
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return Promise.resolve({ code: proc.exitCode, signal: proc.signalCode });
  }
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

function healthOn(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 5000 }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error("health probe timeout")));
    req.on("error", reject);
  });
}

// ─── unit: the resolver ─────────────────────────────────────────────────────

describe("DF-9ROUTER-28 resolvePort — `--port/-p` → PORT → default", () => {
  it("lets the flag win over PORT", () => {
    expect(resolvePort({ argPort: "20130", env: { PORT: "20129" } })).toEqual({
      port: 20130,
      source: "flag",
    });
    expect(resolvePort({ argPort: 20130, env: { PORT: "20129" } })).toEqual({
      port: 20130,
      source: "flag",
    });
  });

  it("uses PORT when no flag is given", () => {
    expect(resolvePort({ argPort: undefined, env: { PORT: "20129" } })).toEqual({
      port: 20129,
      source: "env",
    });
    expect(resolvePort({ argPort: null, env: { PORT: "20129" } })).toEqual({
      port: 20129,
      source: "env",
    });
    // Numeric values are accepted as well (process.env always hands back strings,
    // but the resolver's contract is an integer either way).
    expect(resolvePort({ argPort: undefined, env: { PORT: 20129 } })).toEqual({
      port: 20129,
      source: "env",
    });
  });

  it("trims whitespace around a PORT value", () => {
    expect(resolvePort({ argPort: undefined, env: { PORT: " 20129 " } })).toEqual({
      port: 20129,
      source: "env",
    });
    expect(resolvePort({ argPort: undefined, env: { PORT: "\t65535\n" } })).toEqual({
      port: 65535,
      source: "env",
    });
  });

  it("falls back to the default when neither the flag nor PORT is set", () => {
    expect(resolvePort({ argPort: undefined, env: {} })).toEqual({
      port: DEFAULT_PORT,
      source: "default",
    });
    expect(DEFAULT_PORT).toBe(20128);
    // No PORT in the env → no warning: the default is not a problem to report.
    expect(resolvePort({ argPort: undefined, env: {} }).warning).toBeUndefined();
  });

  it("honours the boundary values 1 and 65535 and rejects 0 / 65536", () => {
    expect(resolvePort({ argPort: undefined, env: { PORT: "1" } })).toEqual({ port: 1, source: "env" });
    expect(resolvePort({ argPort: undefined, env: { PORT: "65535" } })).toEqual({
      port: 65535,
      source: "env",
    });
    expect(resolvePort({ argPort: undefined, env: { PORT: "0" } }).port).toBe(DEFAULT_PORT);
    expect(resolvePort({ argPort: undefined, env: { PORT: "65536" } }).port).toBe(DEFAULT_PORT);
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["non-numeric", "abc"],
    ["zero", "0"],
    ["negative", "-1"],
    ["out of range", "70000"],
    ["float", "20.5"],
    ["trailing garbage", "20128x"],
  ])("rejects an invalid PORT (%s) with a warning and the default", (_label, value) => {
    const resolved = resolvePort({ argPort: undefined, env: { PORT: value } });
    expect(resolved.port).toBe(DEFAULT_PORT);
    expect(resolved.source).toBe("default");
    expect(resolved.warning).toBe(`⚠ Ignoring invalid PORT="${value}" — using ${DEFAULT_PORT}.`);
    expect(resolved.warning.split("\n")).toHaveLength(1); // short-one-line warning
  });

  it("never warns about PORT when the flag already decided the port", () => {
    const resolved = resolvePort({ argPort: "20130", env: { PORT: "abc" } });
    expect(resolved).toEqual({ port: 20130, source: "flag" });
  });

  it("ignores an unusable --port without erroring (legacy fallback)", () => {
    // Same outcome as the pre-change `parseInt(arg) || DEFAULT_PORT`.
    expect(resolvePort({ argPort: "abc", env: {} })).toEqual({ port: DEFAULT_PORT, source: "default" });
    expect(resolvePort({ argPort: "70000", env: {} })).toEqual({ port: DEFAULT_PORT, source: "default" });
    // An unusable flag does not participate in the chain, so a usable PORT still applies.
    expect(resolvePort({ argPort: "abc", env: { PORT: "20129" } })).toEqual({
      port: 20129,
      source: "env",
    });
  });

  it("takes an explicit defaultPort", () => {
    expect(resolvePort({ argPort: undefined, env: {}, defaultPort: 3000 })).toEqual({
      port: 3000,
      source: "default",
    });
    expect(resolvePort({ argPort: undefined, env: { PORT: "abc" }, defaultPort: 3000 }).warning).toBe(
      '⚠ Ignoring invalid PORT="abc" — using 3000.',
    );
  });
});

describe("DF-9ROUTER-28 describeOccupiedPort — the refusal names both remedies", () => {
  it("names the PORT env alternative in the existing-9router variant", () => {
    const message = describeOccupiedPort(20128, { identified: true });
    expect(message).toMatch(/EADDRINUSE/);
    expect(message).toMatch(/existing 9router server/);
    expect(message).toMatch(/--port <other port>/);
    expect(message).toMatch(/PORT=<other port>/);
  });

  it("names the PORT env alternative in the foreign-process variant", () => {
    const message = describeOccupiedPort(20128, { identified: false });
    expect(message).toMatch(/EADDRINUSE/);
    expect(message).toMatch(/another process/);
    expect(message).toMatch(/--port <other port>/);
    expect(message).toMatch(/PORT=<other port>/);
  });
});

// ─── spawn E2E: the real launcher ───────────────────────────────────────────

describe("DF-9ROUTER-28 CLI launcher — the resolved port drives everything", () => {
  let liveProcs = [];
  let occupied = [];

  beforeEach(() => {
    liveProcs = [];
    occupied = [];
    cliRoots = [];
    stopHeartbeats();
  });

  afterEach(async () => {
    // Stop the heartbeat first: the stubs' orphan guard keys off its mtime, and
    // it must not keep refreshing a server the reaper is about to kill.
    stopHeartbeats();
    for (const proc of liveProcs.splice(0)) {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGKILL");
        await waitForExit(proc, 5000);
      }
    }
    for (const server of occupied.splice(0)) await closeServer(server);
    // Belt-and-braces reaper: killLauncherByPort() may kill a launcher whose
    // detached stub child is still booting, which is exactly how the five (in
    // fact nine) orphaned `9router-cli-df28-*` fixture servers piled up on this
    // host (REVIEW-9ROUTER-002c). Race-safe: a stub that exits between the read
    // and the kill makes kill() a harmless no-op.
    const seen = new Set();
    for (const root of cliRoots.splice(0)) {
      const pidMarker = path.join(root, "child-pid.marker");
      try {
        const pid = parseInt(fs.readFileSync(pidMarker, "utf8"), 10);
        if (Number.isInteger(pid) && pid > 1 && !seen.has(pid)) {
          seen.add(pid);
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
      } catch {}
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  function newCli() {
    const cli = makeCliRoot();
    cliRoots.push(cli.root);
    return cli;
  }

  // Both arms assert the SAME claim — "the launcher's port is <expected>" — from
  // the launcher's own output, so the test is valid whether or not <expected> is
  // free on this host:
  //   free  → the stub child is spawned with it, the launcher prints its URL
  //   taken → the pre-flight refusal names exactly that port (no child spawned)
  // On this host a real 9router holds 20128, which is the defect's own scenario.
  async function observeResolvedPort({ proc, captured }, cli, expected) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (fs.existsSync(cli.startedMarker) || proc.exitCode !== null) break;
      await delay(50);
    }
    const output = `${captured.stdout}${captured.stderr}`;

    if (fs.existsSync(cli.startedMarker)) {
      const handed = fs.readFileSync(cli.startedMarker, "utf8");
      expect(handed).toBe(String(expected));
      expect(await waitForOutput(captured, READY_LINE, 30000)).toBe(true);
      expect(output).toMatch(new RegExp(`Server: http://localhost:${expected}`));
      return "spawned";
    }

    const exit = await waitForExit(proc, SPAWN_TIMEOUT);
    expect(exit).not.toBeNull();
    expect(exit.code).not.toBe(0);
    expect(output).toMatch(new RegExp(`Port ${expected} is already in use`));
    expect(output).toMatch(/EADDRINUSE/);
    expect(fs.existsSync(cli.boundMarker)).toBe(false);
    return "refused";
  }

  it(
    "PORT=<env port>: the child is spawned with it and the launcher serves it (never 20128)",
    async () => {
      const cli = newCli();
      const envPort = await preferredPort(20129);

      const spawned = spawnCli(cli, ["-t", "--skip-update"], { port: String(envPort) });
      liveProcs.push(spawned.proc);

      expect(await waitForOutput(spawned.captured, READY_LINE, 30000)).toBe(true);

      // The stub child received the resolved port and really bound it.
      expect(fs.readFileSync(cli.startedMarker, "utf8")).toBe(String(envPort));
      expect(fs.readFileSync(cli.boundMarker, "utf8")).toBe(String(envPort));
      // The launcher's own URL proves which port it probed and serves.
      expect(spawned.captured.stdout).toMatch(new RegExp(`Server: http://localhost:${envPort}`));
      // The hardcoded default must not appear anywhere in the run.
      expect(spawned.output()).not.toMatch(/20128/);
      // And the readiness claim is backed by our child answering on that port.
      expect(await healthOn(envPort)).toEqual({ status: 200, body: '{"ok":true}' });

      spawned.proc.kill("SIGTERM");
      const exit = await waitForExit(spawned.proc, 10000);
      expect(exit).not.toBeNull();
      expect(exit.code).toBe(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "--port <flag port> together with PORT=<env port>: the flag wins",
    async () => {
      const cli = newCli();
      const envPort = await preferredPort(20129);
      const flagPort = await preferredPort(20130, { avoid: [envPort, DEFAULT_PORT] });

      const spawned = spawnCli(cli, ["-t", "--skip-update", "-p", String(flagPort)], {
        port: String(envPort),
      });
      liveProcs.push(spawned.proc);

      expect(await waitForOutput(spawned.captured, READY_LINE, 30000)).toBe(true);

      expect(fs.readFileSync(cli.startedMarker, "utf8")).toBe(String(flagPort));
      expect(fs.readFileSync(cli.boundMarker, "utf8")).toBe(String(flagPort));
      expect(spawned.captured.stdout).toMatch(new RegExp(`Server: http://localhost:${flagPort}`));
      // Neither the env port nor the default is used.
      expect(spawned.captured.stdout).not.toMatch(new RegExp(`Server: http://localhost:${envPort}\\b`));
      expect(spawned.output()).not.toMatch(/20128/);
      expect(await healthOn(flagPort)).toEqual({ status: 200, body: '{"ok":true}' });

      spawned.proc.kill("SIGTERM");
      const exit = await waitForExit(spawned.proc, 10000);
      expect(exit).not.toBeNull();
      expect(exit.code).toBe(0);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "PORT=20129 (the criteria's literal value): the launcher targets 20129, never the default",
    async () => {
      const cli = newCli();
      const spawned = spawnCli(cli, ["-t", "--skip-update"], { port: "20129" });
      liveProcs.push(spawned.proc);

      // Spawned-with-20129 where the host has it free; the pre-flight refusal
      // naming 20129 where the host already runs 9router on it — either way the
      // launcher resolved 20129, not the hardcoded default.
      expect(await observeResolvedPort(spawned, cli, 20129)).toMatch(/spawned|refused/);
      expect(spawned.output()).not.toMatch(/Ignoring invalid PORT/);
      expect(spawned.output()).not.toMatch(/Port 20128 is already in use/);
      expect(spawned.output()).not.toMatch(/Server: http:\/\/localhost:20128/);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "--port 20130 (the criteria's literal value) beats PORT=20129",
    async () => {
      const cli = newCli();
      const spawned = spawnCli(cli, ["-t", "--skip-update", "-p", "20130"], { port: "20129" });
      liveProcs.push(spawned.proc);

      expect(await observeResolvedPort(spawned, cli, 20130)).toMatch(/spawned|refused/);
      expect(spawned.output()).not.toMatch(/Port 20129 is already in use/);
      expect(spawned.output()).not.toMatch(/Server: http:\/\/localhost:20129\b/);
      expect(spawned.output()).not.toMatch(/Server: http:\/\/localhost:20128/);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "no flag and no PORT: the launcher resolves the default 20128",
    async () => {
      const cli = newCli();
      const spawned = spawnCli(cli, ["-t", "--skip-update"], { port: null });
      liveProcs.push(spawned.proc);

      expect(await observeResolvedPort(spawned, cli, DEFAULT_PORT)).toMatch(/spawned|refused/);
      expect(spawned.output()).not.toMatch(/Ignoring invalid PORT/);
    },
    SPAWN_TIMEOUT,
  );

  it.each([["abc"], ["0"], ["70000"]])(
    "invalid PORT=%s: warns, falls back to 20128, and does not crash",
    async (badPort) => {
      const cli = newCli();
      const spawned = spawnCli(cli, ["-t", "--skip-update"], { port: badPort });
      liveProcs.push(spawned.proc);

      expect(await waitForOutput(spawned.captured, "Ignoring invalid PORT", 15000)).toBe(true);
      expect(spawned.output()).toContain(
        `⚠ Ignoring invalid PORT="${badPort}" — using ${DEFAULT_PORT}.`,
      );
      // A warning, not a crash: no exception ever surfaced from the launcher.
      expect(spawned.output()).not.toMatch(/TypeError|ReferenceError|Unhandled/);
      expect(await observeResolvedPort(spawned, cli, DEFAULT_PORT)).toMatch(/spawned|refused/);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "pre-flight probes the RESOLVED port: an occupied env port is refused by name, no child spawned",
    async () => {
      const cli = newCli();
      const dummy = await startDummyListener();
      occupied.push(dummy);
      const envPort = dummy.port;

      const spawned = spawnCli(cli, ["-t", "--skip-update"], { port: String(envPort) });
      liveProcs.push(spawned.proc);
      const exit = await waitForExit(spawned.proc, SPAWN_TIMEOUT);

      expect(exit).not.toBeNull();
      expect(exit.code).not.toBe(0);
      // The refusal names the ENV port — proof the probe targeted it, not 20128.
      expect(spawned.captured.stderr).toMatch(new RegExp(`Port ${envPort} is already in use`));
      expect(spawned.captured.stderr).toMatch(/EADDRINUSE/);
      expect(spawned.captured.stderr).toMatch(/PORT=<other port>/);
      expect(spawned.output()).not.toMatch(/20128/);
      expect(spawned.captured.stdout).not.toMatch(new RegExp(READY_LINE));
      expect(fs.existsSync(cli.startedMarker)).toBe(false);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "--help documents PORT as the env fallback and --port as the override",
    async () => {
      const cli = newCli();
      const spawned = spawnCli(cli, ["--help"]);
      liveProcs.push(spawned.proc);
      const exit = await waitForExit(spawned.proc, SPAWN_TIMEOUT);

      expect(exit).toEqual({ code: 0, signal: null });
      expect(spawned.captured.stdout).toMatch(/PORT\s+Port to run the server when --port\/-p is not given/);
      expect(spawned.captured.stdout).toMatch(
        new RegExp(`precedence: --port/-p → PORT → ${DEFAULT_PORT}`),
      );
      expect(spawned.captured.stdout).toMatch(/-p, --port <port>/);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "orphan guard: a stub whose test died stops itself (the abandoned-boats fix)",
    async () => {
      const cli = newCli();
      const envPort = await preferredPort(20129);

      // Forced-low thresholds make the self-exit provable in seconds; production
      // defaults (30s max age, 10s checks) are what runs leave behind.
      const spawned = spawnCli(cli, ["-t", "--skip-update"], {
        port: String(envPort),
        stubEnv: { STUB_HEARTBEAT_MAX_MS: "2000", STUB_HEARTBEAT_CHECK_MS: "500" },
      });
      liveProcs.push(spawned.proc);

      // The stub is really up, really detached-orphaned territory, and serving.
      expect(await waitForOutput(spawned.captured, READY_LINE, 30000)).toBe(true);
      const pid = parseInt(fs.readFileSync(path.join(cli.root, "child-pid.marker"), "utf8"), 10);
      expect(Number.isInteger(pid) && pid > 1).toBe(true);
      expect(await healthOn(envPort)).toEqual({ status: 200, body: '{"ok":true}' });

      // The test run "dies": heartbeats stop without any signal reaching the
      // stub — exactly the state a killed runner leaves behind. Age the marker
      // past the stub's max age (and stop the refresher first so it cannot
      // resurrect the state).
      stopHeartbeats();
      const dead = new Date(Date.now() - 60_000);
      fs.utimesSync(path.join(cli.root, "child-heartbeat.marker"), dead, dead);

      let gone = false;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try {
          process.kill(pid, 0);
        } catch {
          gone = true;
          break;
        }
        await delay(250);
      }
      // The stray is gone BY ITSELF and the port is released — no reaper needed.
      expect(gone).toBe(true);
      expect(await isPortFree(envPort)).toBe(true);
    },
    SPAWN_TIMEOUT,
  );
});
