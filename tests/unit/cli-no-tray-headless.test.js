/**
 * DF-9ROUTER-64 — a headless escape hatch for the launcher lifecycle.
 *
 * Published-package instances on a headless host died SILENTLY: two
 * unexplained process deaths in 50 minutes, zero log lines, no kernel OOM, data
 * intact. Every lifecycle path the launcher can take after spawning the server
 * assumes a display + TTY: the optional `--tray` mode, the interactive
 * interface menu loop, the hide-to-tray background relaunch, and the
 * `--skip-update` + non-TTY auto-flip into tray mode. Nothing on that path
 * existed for an operator who just wants the server in the foreground — and
 * several exits on it produced no output at all (SIGHUP, a child close, a
 * swallowed uncaughtException).
 *
 * Coverage, in two layers:
 *
 *  1. UNIT — `--no-tray` discoverability and the mode ordering inside cli.js:
 *     the flag is documented by --help, and the source places the headless
 *     branch BETWEEN the tray branch (which it must override) and the
 *     interactive menu loop (which it must skip).
 *
 *  2. SPAWN E2E — the REAL `cli/cli.js` against the same hermetic fixture as
 *     cli-port-resolution.test.js (temp CLI root + stub server + PATH stubs for
 *     ps/lsof/npm + ephemeral HOME/DATA_DIR), proving BEHAVIOR:
 *       - `--no-tray`: launcher skips the tray/UI lifecycle and stays alive in
 *         the foreground — headless banner + `server ready` line, stub server
 *         answering /api/health, launcher process STILL RUNNING well past the
 *         point where the default path's non-TTY menu loop has already exited,
 *         and stdout untouched by the default path's markers (no interface
 *         menu, no tray line). SIGTERM then stops it with a timestamped
 *         `exiting: signal` line and code 0.
 *       - default (no flag): the pre-existing fingerprint is unchanged — the
 *         launcher reaches readiness, then the non-TTY interface menu resolves
 *         to "exit" and the launcher exits 0 on its own, with no tray line on
 *         a headless box (tray init is display-gated exactly as before this
 *         change).
 *       - loud exits: a SIGTERM on the DEFAULT path (sent between child spawn
 *         and menu render — the pre-menu window is deterministic, the post-menu
 *         one is a ~100ms race) now leaves a timestamped `[9router] exiting:`
 *         line on stderr before the process goes away.
 *
 * Hermeticity (inherited): DISPLAY is unset so no system tray can init; `npm`
 * is a stub that fails offline, so any attempt to lazy-install the tray
 * runtime fails instead of silently succeeding; the kill-all/pre-flight
 * cleanup is stubbed out at the PATH level so the run never touches live
 * processes. Ports are dynamically free ones (a busy host may hold 20128+).
 *
 * Orphan guard (same lesson as cli-port-resolution / REVIEW-9ROUTER-002c): the
 * launcher spawns the stub DETACHED, so a dead test run would leave a stray
 * server. The stub self-exits when its heartbeat marker goes stale, and the
 * suite's afterEach reaps by recorded pid as belt-and-braces.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// Lines the launcher prints on each lifecycle path.
const TRAY_READY_LINE = "Router is now running in system tray";
const HEADLESS_BANNER = "(headless)";
const SERVER_READY_LINE = "server ready on";
const MENU_LINE = "Web UI (Open in Browser)";
const EXITING_LINE = "Exiting...";
const SIGNAL_EXIT_RE = /\[\d{4}-\d{2}-\d{2}T[^\]]+\] \[9router\] exiting: signal \{"signal":"SIGTERM"\}/;

const SPAWN_TIMEOUT = 60000;

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

function pickFreePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Stand-in for the Next standalone server: binds PORT, answers /api/health,
// records its pid. Same contract as cli-port-resolution's stub, including the
// orphan heartbeat.
const STUB_SERVER_JS = [
  '"use strict";',
  'const fs = require("fs");',
  'const http = require("http");',
  'const port = parseInt(process.env.PORT, 10) || 0;',
  'if (process.env.STUB_CHILD_MARKER) fs.writeFileSync(process.env.STUB_CHILD_MARKER, String(port));',
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
  '// Orphan guard: a fixture server must never outlive its test run (see',
  '// cli-port-resolution.test.js — nine strays piled up on the fleet host).',
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

function makeCliRoot({ withDeps = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cli-df64-"));
  for (const rel of ["cli.js", "package.json", "hooks", "src"]) {
    fs.cpSync(path.join(REPO_ROOT, "cli", rel), path.join(root, rel), { recursive: true });
  }
  // The published tarball ships the package files PLUS the production
  // node_modules (npm includes deps automatically), and the launcher's
  // post-readiness default path reaches src/cli/api/client.js →
  // `node-machine-id`. A checkout that ran `npm --prefix cli install` has
  // cli/node_modules; a FRESH box only has the ROOT tree (npm ci at the repo
  // root, whose package.json carries the same cli runtime deps: enquirer,
  // node-forge, node-machine-id, react, react-dom, confbox). Resolve from
  // either, in that order — never from a hardcoded developer path, which made
  // this fixture pass only on the dev host (DF-9ROUTER-70).
  // `withDeps: false` deliberately withholds both, i.e. the clean-machine
  // shape where the launcher must still honour its non-TTY promise without
  // the interactive menu stack.
  const cliNodeModules = withDeps
    ? [path.join(REPO_ROOT, "cli", "node_modules"), path.join(REPO_ROOT, "node_modules")]
        .find((candidate) => fs.existsSync(candidate))
    : null;
  if (cliNodeModules) {
    try { fs.symlinkSync(cliNodeModules, path.join(root, "node_modules"), "dir"); } catch {}
  }
  const appDir = path.join(root, "app");
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, "server.js"), STUB_SERVER_JS);
  // Seed the heartbeat marker the stub watches; startHeartbeats() refreshes its
  // mtime while the test is alive.
  fs.writeFileSync(path.join(root, "child-heartbeat.marker"), "");

  // PATH stubs: keep the run hermetic (same rules as cli-port-resolution).
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
    pidMarker: path.join(root, "child-pid.marker"),
    appDir,
  };
}

// `port` is the ambient PORT the launcher must resolve from: pass a number to
// set it, `null` to leave it unset.
function spawnCli(cli, args, { port = null } = {}) {
  const env = { ...process.env };
  delete env.DISPLAY; // headless: no system tray init
  delete env.PORT;
  env.PATH = `${cli.binDir}${path.delimiter}${process.env.PATH || ""}`;
  env.HOME = path.join(cli.root, "home");
  env.DATA_DIR = path.join(cli.root, "data");
  env.STUB_CHILD_MARKER = cli.startedMarker;
  env.STUB_BOUND_MARKER = cli.boundMarker;
  env.STUB_PID_MARKER = cli.pidMarker;
  env.STUB_HEARTBEAT_MARKER = path.join(cli.root, "child-heartbeat.marker");
  if (port !== null) env.PORT = String(port);

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

async function waitForFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return true;
    await delay(50);
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

function killByPid(pid) {
  try {
    process.kill(-pid, "SIGKILL"); // negative: the launcher's detached child leads its own group
  } catch {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
}

// ─── unit: flag surface + mode ordering ─────────────────────────────────────

describe("DF-9ROUTER-64 — --no-tray flag surface", () => {
  it("documents --no-tray in --help output", async () => {
    const cli = makeCliRoot();
    cliRoots.push(cli.root);
    const spawned = spawnCli(cli, ["--help"]);
    const exit = await waitForExit(spawned.proc, SPAWN_TIMEOUT);

    expect(exit).toEqual({ code: 0, signal: null });
    expect(spawned.captured.stdout).toMatch(/--no-tray\s+Headless mode/);
    expect(spawned.captured.stdout).toMatch(/skip tray\/UI, serve in the foreground/);
  }, SPAWN_TIMEOUT);

  it("orders the headless branch between the tray branch and the menu loop", () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, "cli", "cli.js"), "utf8");
    const trayBranch = source.indexOf("if (trayMode && !noTray)");
    const headlessBranch = source.indexOf("if (noTray)");
    // Anchor on the menu LOOP's call shape, not on its argument name: the
    // literal `showInterfaceMenu(latestVersion)` also occurs in the function
    // DEFINITION far above (which proves nothing about ordering), and the
    // argument was renamed to `updateOffer` by DF-9ROUTER-68 — which turned
    // this assertion red on every host while the real ordering was intact.
    const menuLoop = source.indexOf("await showInterfaceMenu(", headlessBranch);

    // Both branches exist, --no-tray overrides tray mode, and the headless
    // branch is reached BEFORE the interactive menu loop can.
    expect(trayBranch).toBeGreaterThan(-1);
    expect(headlessBranch).toBeGreaterThan(-1);
    expect(menuLoop).toBeGreaterThan(-1);
    expect(trayBranch).toBeLessThan(headlessBranch);
    expect(headlessBranch).toBeLessThan(menuLoop);

    // The default path resolves a non-TTY launch to the documented exit BEFORE
    // the interactive menu stack is loaded (DF-9ROUTER-70: on a clean box the
    // menu's `node-machine-id` require threw and the launcher exited 1).
    const nonTtyResolve = source.indexOf("if (!process.stdin.isTTY)", headlessBranch);
    expect(nonTtyResolve).toBeGreaterThan(-1);
    expect(nonTtyResolve).toBeLessThan(menuLoop);

    // The non-TTY auto-flip into tray mode honours the flag.
    expect(source).toMatch(/skipUpdate && !trayMode && !noTray && !process\.stdin\.isTTY/);
    // The tray runtime self-heal is skipped on the headless path.
    expect(source).toMatch(/if \(!noTrayRequested\) \{\s*\n\s*try \{ ensureTrayRuntime/);
  });
});

// ─── spawn E2E: the real launcher ───────────────────────────────────────────

describe("DF-9ROUTER-64 CLI launcher — headless vs default lifecycle", () => {
  let liveProcs = [];

  beforeEach(() => {
    liveProcs = [];
    cliRoots = [];
    stopHeartbeats();
  });

  afterEach(async () => {
    // Stop the heartbeat first: the stubs' orphan guard keys off its mtime.
    stopHeartbeats();
    for (const proc of liveProcs.splice(0)) {
      if (proc.exitCode === null && proc.signalCode === null) killByPid(proc.pid);
      await waitForExit(proc, 5000);
    }
    // Belt-and-braces reaper: kill any stub server recorded by the fixture
    // (race-safe — a stub that already exited makes kill() a harmless no-op),
    // then remove the temp root.
    const seen = new Set();
    for (const root of cliRoots.splice(0)) {
      try {
        const pid = parseInt(fs.readFileSync(path.join(root, "child-pid.marker"), "utf8"), 10);
        if (Number.isInteger(pid) && pid > 1 && !seen.has(pid)) {
          seen.add(pid);
          killByPid(pid);
        }
      } catch {}
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it(
    "--no-tray: skips the tray/UI lifecycle and serves in the foreground",
    async () => {
      const cli = makeCliRoot();
      cliRoots.push(cli.root);
      const port = await pickFreePort();

      const spawned = spawnCli(cli, ["--no-tray", "--skip-update", "-p", String(port)]);
      liveProcs.push(spawned.proc);

      // Headless banner, then the readiness line — the no-tray lifecycle.
      expect(await waitForOutput(spawned.captured, HEADLESS_BANNER, 20000)).toBe(true);
      expect(await waitForOutput(spawned.captured, SERVER_READY_LINE, 30000)).toBe(true);

      // The stub server is really up and answering.
      expect(fs.readFileSync(cli.startedMarker, "utf8")).toBe(String(port));
      expect(fs.readFileSync(cli.boundMarker, "utf8")).toBe(String(port));
      expect(await healthOn(port)).toEqual({ status: 200, body: '{"ok":true}' });

      // No tray/UI lifecycle markers anywhere in the output.
      expect(spawned.output()).not.toMatch(new RegExp(TRAY_READY_LINE));
      expect(spawned.output()).not.toMatch(new RegExp(MENU_LINE));

      // THE core assertion: still alive in the foreground. The DEFAULT path's
      // non-TTY menu loop resolves to "exit" and is gone within seconds of
      // readiness — this launch must have outlived that window.
      await delay(6000);
      expect(spawned.proc.exitCode).toBeNull();
      expect(spawned.proc.signalCode).toBeNull();
      expect(await healthOn(port)).toEqual({ status: 200, body: '{"ok":true}' });

      // Graceful shutdown: timestamped exit line on stderr, then code 0.
      spawned.proc.kill("SIGTERM");
      const exit = await waitForExit(spawned.proc, 15000);
      expect(exit).not.toBeNull();
      expect(exit.code).toBe(0);
      expect(spawned.captured.stderr).toMatch(SIGNAL_EXIT_RE);
    },
    SPAWN_TIMEOUT,
  );

  it(
    "default (no flag): unchanged fingerprint — non-TTY menu resolves to exit, launcher exits 0 on its own",
    async () => {
      const cli = makeCliRoot();
      cliRoots.push(cli.root);
      const port = await pickFreePort();

      // NOTE: no --skip-update. With it, the launcher's documented non-TTY
      // fallback silently flips this launch into tray mode (its behavior for
      // detached relaunches); the DEFAULT interactive path is this one.
      const spawned = spawnCli(cli, ["-p", String(port)]);
      liveProcs.push(spawned.proc);

      // Non-TTY: the launcher exits BY ITSELF shortly after readiness — the
      // exact pre-change behavior this task must not alter. (The exit code 0
      // is only reachable through the readiness gate + the interface menu
      // resolving to "exit", so this IS the default lifecycle fingerprint.)
      const exit = await waitForExit(spawned.proc, 30000);
      expect(exit).toEqual({ code: 0, signal: null });

      // The default path's own markers: graceful exit line, stub spawned and
      // bound on the resolved port, and no headless banner (the --no-tray
      // branch is not taken without the flag).
      expect(spawned.captured.stdout).toContain(EXITING_LINE);
      expect(fs.readFileSync(cli.startedMarker, "utf8")).toBe(String(port));
      expect(fs.readFileSync(cli.boundMarker, "utf8")).toBe(String(port));
      expect(spawned.output()).not.toMatch(new RegExp(HEADLESS_BANNER));
      expect(spawned.output()).not.toMatch(new RegExp(TRAY_READY_LINE));
    },
    SPAWN_TIMEOUT,
  );

  it(
    "clean-box cell: default path exits 0 with NO resolvable cli deps (fresh checkout, no npm --prefix cli install)",
    async () => {
      // The DF-9ROUTER-70 defect: the fixture used to link a developer-machine
      // cli/node_modules, so this promise was only ever proven where the
      // interactive menu stack happened to be installed. Here the fixture root
      // has no node_modules at all — the shape of a box that ran `npm ci` at
      // the repo root and nothing else — and stdin is a pipe (spawn stdio[0]
      // is "ignore"), so the launcher must resolve the non-TTY default to
      // "exit" without requiring anything from the menu.
      const cli = makeCliRoot({ withDeps: false });
      cliRoots.push(cli.root);
      const port = await pickFreePort();

      const spawned = spawnCli(cli, ["-p", String(port)]);
      liveProcs.push(spawned.proc);
      expect(spawned.proc.stdin).toBeNull(); // explicit non-TTY stdin

      const exit = await waitForExit(spawned.proc, 30000);
      expect(exit).toEqual({ code: 0, signal: null });
      expect(spawned.captured.stdout).toContain(EXITING_LINE);
      // No module-resolution error leaked out of the exit path.
      expect(spawned.output()).not.toMatch(/Cannot find module/);
      expect(fs.readFileSync(cli.startedMarker, "utf8")).toBe(String(port));
      expect(fs.readFileSync(cli.boundMarker, "utf8")).toBe(String(port));
    },
    SPAWN_TIMEOUT,
  );

  it(
    "default path: SIGTERM (pre-menu window) leaves a timestamped exit line before the process goes away",
    async () => {
      const cli = makeCliRoot();
      cliRoots.push(cli.root);
      const port = await pickFreePort();

      // No --skip-update (see the default-fingerprint test: with it, the
      // non-TTY fallback flips the launch into tray mode).
      const spawned = spawnCli(cli, ["-p", String(port)]);
      liveProcs.push(spawned.proc);

      // The stub's started marker proves startServer() ran (signal handlers
      // registered) while the menu has NOT resolved yet — signalling here is
      // deterministic, signalling after the menu is a ~100ms race against the
      // non-TTY menu's own exit.
      expect(await waitForFile(cli.startedMarker, 20000)).toBe(true);
      spawned.proc.kill("SIGTERM");

      const exit = await waitForExit(spawned.proc, 15000);
      expect(exit).not.toBeNull();
      expect(exit.code).toBe(0);
      expect(spawned.captured.stderr).toMatch(SIGNAL_EXIT_RE);
    },
    SPAWN_TIMEOUT,
  );
});
