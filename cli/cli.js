#!/usr/bin/env node

const { spawn, exec, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const net = require("net");
const os = require("os");

// Poll until the server accepts TCP connections on port, or timeout — avoids blind fixed waits.
function waitServerReady(port, { timeoutMs = 15000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const tryConnect = () => {
      const socket = net.connect({ host: "127.0.0.1", port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tryConnect, intervalMs);
      });
    };
    tryConnect();
  });
}

// Native spinner - no external dependency
function createSpinner(text) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let interval = null;
  let currentText = text;
  return {
    start() {
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${frames[0]} ${currentText}`);
        interval = setInterval(() => {
          process.stdout.write(`\r${frames[i++ % frames.length]} ${currentText}`);
        }, 80);
      }
      return this;
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (process.stdout.isTTY) {
        process.stdout.write("\r\x1b[K");
      }
    },
    succeed(msg) {
      this.stop();
      console.log(`✅ ${msg}`);
    },
    fail(msg) {
      this.stop();
      console.log(`❌ ${msg}`);
    }
  };
}

const pkg = require("./package.json");
const { ensureSqliteRuntime, buildEnvWithRuntime } = require("./hooks/sqliteRuntime");
const { ensureTrayRuntime } = require("./hooks/trayRuntime");
const args = process.argv.slice(2);

// F23 (T1.6 M1/M2): the ownership matcher and the escalation engine below are
// unit-tested by requiring this file (tests/unit/f23-*.test.js). Everything
// that touches the machine — runtime self-heal installs, process listings and
// kills, server spawn — runs only when this file is the entry point. A
// required copy must be inert: it must never kill a process on the test host.
const IS_MAIN = require.main === module;

// Subcommands (`9router xai video …`) run against an already-running gateway
// and bypass the launcher flow (no runtime self-heal, no server spawn).
if (IS_MAIN && args[0] === "xai" && args[1] === "video") {
  const { run } = require("./src/cli/commands/xaiVideo");
  run(args.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`❌ ${err?.message || err}`);
      process.exit(1);
    });
  return;
}

// Self-heal SQLite runtime deps (sql.js + better-sqlite3) into ~/.9router/runtime
// so the server can resolve them via NODE_PATH. Best-effort — sql.js is required,
// better-sqlite3 is optional. Logs to stderr only on failure.
if (IS_MAIN) { try { ensureSqliteRuntime({ silent: true }); } catch {} }

// Self-heal tray runtime (systray for macOS/Linux only). Windows skipped.
if (IS_MAIN) { try { ensureTrayRuntime({ silent: true }); } catch {} }

// Configuration constants
const APP_NAME = pkg.name; // Use from package.json
const INSTALL_CMD_LATEST = `npm i -g ${APP_NAME}@latest --prefer-online`;

const DEFAULT_PORT = 20128;
const DEFAULT_HOST = "0.0.0.0";

// Server shutdown budget, module-wide (F23/M1). The server drains in-flight
// usage writes and checkpoints the SQLite WAL on SIGTERM before exiting
// (src/shared/services/shutdownCoordinator.js: 3s drain + 2s hard watchdog).
// SIGKILL cannot be caught, so every kill path must ASK first and only escalate
// after this grace window — the restart path used to SIGKILL on sight,
// discarding exactly what the drain exists to save.
const SHUTDOWN_GRACE_MS = 8000;
// F23/M5 bound: killTray() waits for the Go tray binary to exit (escalates at
// 800/1600ms, polls up to ~3s). Exit paths that call process.exit() must wait
// for it — bounded, so a wedged tray can never hold the launcher open.
const TRAY_EXIT_BOUND_MS = 4000;

// First non-internal IPv4 — the address remote peers actually reach when bound to 0.0.0.0.
function getLanIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return null;
}

// Local URL stays "localhost"; warn separately when bound to all interfaces (network-exposed).
function getDisplayHost() {
  return host === DEFAULT_HOST ? "localhost" : host;
}
const MAX_PORT_ATTEMPTS = 10;

// ── Process ownership (F23/T1.6 M2) ─────────────────────────────────────────
//
// The old matcher killed any process whose cmdline contained "9router" plus
// every "next-server" on the machine — i.e. every unrelated Next.js dev server,
// `grep 9router`, a `tail -f ~/.9router/server.log`, and (via "/9router"
// matching "/9router-enhanced") even this repo's own dev server. A foreign
// process is ours only when a FACT ties it to this installation:
//
//   1. its argv contains the EXACT installed path (this cli.js, the standalone
//      server file, or a file under this install's directories); or
//   2. its working directory IS this installation's standalone app dir — the
//      standalone server rewrites its process title ("next-server (vX)"), so
//      argv stops carrying the path; or
//   3. it owns the app port as a TCP LISTENER — enforced by killProcessOnPort,
//      never by name guessing.
//
// Loose package-name substrings are never a kill reason.

// True when `cmd` references `p` as a complete path element: the character
// before must be a separator/space (not a path continuation, so
// "/inst/cli/app" cannot match inside "/inst/cli/application"), and the
// character after must be end/space/separator — not ".map" or "-old".
function cmdContainsExactPath(cmd, p, { caseInsensitive = false } = {}) {
  if (!p) return false;
  const hay = caseInsensitive ? String(cmd).toLowerCase() : String(cmd);
  const needle = caseInsensitive ? String(p).toLowerCase() : String(p);
  let idx = hay.indexOf(needle);
  while (idx !== -1) {
    const before = idx === 0 ? " " : hay[idx - 1];
    const after = idx + needle.length >= hay.length ? " " : hay[idx + needle.length];
    if (!/[A-Za-z0-9._-]/.test(before) && !/[A-Za-z0-9._-]/.test(after)) return true;
    idx = hay.indexOf(needle, idx + 1);
  }
  return false;
}

function trimPathSep(p) {
  return String(p).replace(/[\\/]+$/, "");
}

// Pure predicate over one parsed process entry: { pid, cmd, cwd? }.
// opts: { selfPid, ownedPaths: string[], ownedDirs: string[],
//         caseInsensitive, resolveCwd?: (pid) => string|null }
function isOwnAppProcess(entry, opts = {}) {
  if (!entry || entry.pid == null) return false;
  const { selfPid = null, ownedPaths = [], ownedDirs = [], caseInsensitive = false, resolveCwd = null } = opts;
  if (selfPid != null && String(entry.pid) === String(selfPid)) return false;
  const cmd = String(entry.cmd || "");

  for (const p of ownedPaths) {
    if (cmdContainsExactPath(cmd, p, { caseInsensitive })) return true;
  }
  for (const d of ownedDirs) {
    if (!d) continue;
    // A file under this install's directory appearing in argv (server.js,
    // tray binary under <install>/cli/node_modules/…): dir must be followed
    // by a path separator, so "/inst/cli/app" never matches "/inst/cli/apptool".
    const dir = trimPathSep(d);
    if (cmdContainsExactPath(cmd, dir, { caseInsensitive }) ||
        cmdContainsExactPath(cmd, dir + "/", { caseInsensitive }) ||
        cmdContainsExactPath(cmd, dir + "\\", { caseInsensitive })) return true;
    if (resolveCwd) {
      let cwd = entry.cwd;
      if (cwd === undefined) {
        try { cwd = resolveCwd(entry.pid); } catch { cwd = null; }
      }
      if (cwd) {
        const a = trimPathSep(cwd);
        const b = trimPathSep(dir);
        const eq = caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b;
        if (eq) return true;
      }
    }
  }
  return false;
}

// "  4242 /usr/bin/node /opt/9router/cli/app/custom-server.js" → {pid, cmd}
// Format: `ps -eo pid=,command=`. Header/`ps` itself/garbage → null.
function parsePidCommand(line) {
  const m = /^\s*(\d+)\s+(\S.*)$/.exec(String(line));
  if (!m) return null;
  return { pid: m[1], cmd: m[2] };
}

// Windows WMI CSV row: `"4242","C:\Program Files\node.exe ...\cli.js --tray"`
// (CSV escapes embedded quotes by doubling them.)
function parseWmiCsvEntry(line) {
  const m = /^\s*"(\d+)","(.*)"\s*$/.exec(String(line));
  if (!m) return null;
  return { pid: m[1], cmd: m[2].replace(/""/g, '"') };
}

function collectOwnAppPids(entries, opts = {}) {
  const out = [];
  for (const e of entries || []) {
    if (e && isOwnAppProcess(e, opts)) out.push(e);
  }
  return out;
}

// Real process table for the ownership matcher. `ps aux` leaks the USER column
// into the matched string (a user literally named "9router" used to qualify);
// `ps -eo pid=,command=` pins exactly pid + argv.
function readProcessList(platform = process.platform) {
  const entries = [];
  try {
    if (platform === "win32") {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "Get-WmiObject Win32_Process -Filter 'Name=\\"node.exe\\" OR Name=\\"tray_windows_release.exe\\"' | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"`;
      const output = execSync(psCmd, { encoding: "utf8", windowsHide: true, timeout: 5000 });
      for (const line of output.split("\n").slice(1)) {
        const e = parseWmiCsvEntry(line);
        if (e) entries.push(e);
      }
    } else {
      const output = execSync("ps -eo pid=,command= 2>/dev/null", { encoding: "utf8", timeout: 5000 });
      for (const line of output.split("\n")) {
        const e = parsePidCommand(line);
        if (e) entries.push(e);
      }
    }
  } catch { /* no processes found */ }
  return entries;
}

function readProcCwd(pid) {
  try { return fs.realpathSync(`/proc/${pid}/cwd`); } catch { return null; }
}

// ── Ask-shutdown-then-kill engine (F23/T1.6 M1) ─────────────────────────────
//
// cleanup()'s graceful branch already SIGTERMs our own server and waits
// SHUTDOWN_GRACE_MS before escalating; foreign instances (the previous
// launcher and its detached server, hit by the restart path) must get the same
// chance. SIGTERM is the "ask": the server's shutdownCoordinator drains
// in-flight usage writes and checkpoints the WAL on it. Every primitive is
// injectable so unit tests can drive fake process tables — no real signal is
// ever sent from a test.
async function terminatePidsGracefully(pids, {
  graceMs = SHUTDOWN_GRACE_MS,
  pollMs = 100,
  platform = process.platform,
  signal = (pid, sig) => { process.kill(Number(pid), sig); },
  isAlive = (pid) => {
    try { process.kill(Number(pid), 0); return true; }
    catch (e) { return e && e.code === "EPERM"; } // exists, not ours
  },
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
} = {}) {
  const list = [...new Set((pids || []).map(String).filter((p) => /^\d+$/.test(p)))];
  const res = { asked: [], exited: [], killed: [] };
  if (list.length === 0) return res;

  const win = platform === "win32";
  const ask = (pid) => {
    if (win) execSync(`taskkill /T /PID ${pid} 2>nul`, { stdio: "ignore", shell: true, windowsHide: true, timeout: 3000 });
    else signal(pid, "SIGTERM");
  };
  const force = (pid) => {
    if (win) execSync(`taskkill /F /T /PID ${pid} 2>nul`, { stdio: "ignore", shell: true, windowsHide: true, timeout: 3000 });
    else signal(pid, "SIGKILL");
  };

  for (const pid of list) {
    try { ask(pid); res.asked.push(pid); } catch { /* already gone */ }
  }

  let pending = res.asked.slice();
  const deadline = now() + Math.max(0, graceMs);
  while (pending.length && now() < deadline) {
    await sleep(pollMs);
    pending = pending.filter((pid) => { try { return isAlive(pid); } catch { return true; } });
  }
  for (const pid of pending) {
    try { force(pid); res.killed.push(pid); } catch { /* exited in the meantime */ }
  }
  if (res.killed.length) await sleep(Math.min(pollMs * 5, 500));
  res.exited = res.asked.filter((pid) => !res.killed.includes(pid));
  return res;
}

// Resolve `promise` within boundMs. Never rejects, never waits past the bound.
// True = settled in time; false = the bound expired.
function settleWithBound(promise, boundMs, { setTimeoutRef = (fn, ms) => setTimeout(fn, ms), clearTimeoutRef = clearTimeout } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (settled) => {
      if (done) return;
      done = true;
      clearTimeoutRef(timer);
      resolve(settled);
    };
    const timer = setTimeoutRef(() => finish(false), boundMs);
    Promise.resolve(promise).then(() => finish(true), () => finish(true));
  });
}

// PIDs from `lsof -nP -iTCP:PORT -sTCP:LISTEN -t` (LISTEN sockets only).
// The old `lsof -ti:PORT` also matched CLIENTS connected to the port and took
// `[0]` — a user's running SDK script talking to the gateway could be the
// process killed.
function parseLsofListenerPids(out) {
  return String(out || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d+$/.test(l));
}

// netstat -ano rows: LOCAL address must end with :PORT and state must be
// LISTENING. findstr ":PORT" alone matches ESTABLISHED rows whose REMOTE side
// (or a client's ephemeral local port) contains the number.
function parseNetstatListenerPids(out, port) {
  const pids = [];
  String(out || "").split(/\r?\n/).forEach((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) return;
    const [proto, local, , state, pid] = parts;
    if (!/^(TCP|UDP)/i.test(proto) || !/LISTENING/i.test(state)) return;
    if (!local.endsWith(`:${port}`)) return;
    if (/^\d+$/.test(pid) && Number(pid) > 0) pids.push(pid);
  });
  return [...new Set(pids)];
}

function readListenerPids(port, platform = process.platform) {
  try {
    if (platform === "win32") {
      const output = execSync(`netstat -ano | findstr LISTENING`, {
        encoding: "utf8", shell: true, windowsHide: true, timeout: 5000, stdio: ["pipe", "pipe", "ignore"],
      });
      return parseNetstatListenerPids(output, port);
    }
    const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], timeout: 5000,
    });
    return parseLsofListenerPids(output);
  } catch { return []; } // lsof/netstat exit non-zero when the port is free
}

// Kill all launcher/server processes OF THIS INSTALLATION.
// deps are injectable for tests (fake process tables, fake signals).
async function killAllAppProcesses(appPort, deps = {}) {
  const {
    platform = process.platform,
    selfPid = process.pid,
    readProcessListImpl = readProcessList,
    resolveCwd = platform === "linux" ? readProcCwd : () => null,
    ownedPaths = [__filename, serverPath],
    ownedDirs = [standaloneDir, __dirname],
    caseInsensitive = platform === "win32",
    graceMs = SHUTDOWN_GRACE_MS,
    backgroundCleanup = null,
    ...terminate
  } = deps;

  // Background: MITM + tunnel/cloudflared run on separate ports/processes —
  // killing them doesn't free the app port, so don't block the critical path.
  // Server-side MITM manager has stale-lock recovery and starts deferred (~3s).
  // Injectable: unit tests must never touch this host's real PID files.
  const runBackground = () => {
    try { killProxyByPidFile(); } catch {}
    try { killTunnelByPidFile(); } catch {}
    try { killCloudflaredByAppPort(appPort); } catch {}
  };
  setImmediate(() => (backgroundCleanup || runBackground)(appPort));

  let owned = [];
  try {
    const entries = readProcessListImpl(platform);
    owned = collectOwnAppPids(entries, { selfPid, ownedPaths, ownedDirs, caseInsensitive, resolveCwd });
  } catch { /* keep going — the port kill below is the safety net */ }

  if (owned.length > 0) {
    return terminatePidsGracefully(owned.map((e) => e.pid), { graceMs, platform, ...terminate });
  }
  return { asked: [], exited: [], killed: [] };
}

// Kill the process LISTENING on the app port (and nothing else): a client with
// an ESTABLISHED connection to the gateway is never touched. Ask first, then
// escalate; then poll until the LISTEN socket is actually gone (bounded) —
// replacing the old blind 500 ms sleep.
async function killProcessOnPort(port, deps = {}) {
  const {
    platform = process.platform,
    selfPid = process.pid,
    readListeners = () => readListenerPids(port, platform),
    graceMs = SHUTDOWN_GRACE_MS,
    pollMs = 100,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
  } = deps;

  const initial = (readListeners() || []).map(String).filter((p) => /^\d+$/.test(p) && p !== String(selfPid));
  let res = { asked: [], exited: [], killed: [] };
  if (initial.length > 0) {
    res = await terminatePidsGracefully(initial, {
      graceMs, pollMs, platform, sleep, now,
      signal: deps.signal, isAlive: deps.isAlive,
    });
  }

  // Port-release poll: bounded by a second, small window after the owners are
  // gone (kernel teardown), instead of assuming 500 ms is enough.
  const releaseDeadline = now() + 2000;
  while (now() < releaseDeadline && (readListeners() || []).some((p) => String(p) !== String(selfPid))) {
    await sleep(pollMs);
  }
  return res;
}
// Parse arguments
let port = DEFAULT_PORT;
let host = DEFAULT_HOST;
let noBrowser = false;
let skipUpdate = false;
let showLog = false;
let trayMode = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" || args[i] === "-p") {
    port = parseInt(args[i + 1], 10) || DEFAULT_PORT;
    i++;
  } else if (args[i] === "--host" || args[i] === "-H") {
    host = args[i + 1] || DEFAULT_HOST;
    i++;
  } else if (args[i] === "--no-browser" || args[i] === "-n") {
    noBrowser = true;
  } else if (args[i] === "--log" || args[i] === "-l") {
    showLog = true;
  } else if (args[i] === "--skip-update") {
    skipUpdate = true;
  } else if (args[i] === "--tray" || args[i] === "-t") {
    trayMode = true;
    if (IS_MAIN) process.env.TRAY_MODE = "1";
  } else if (args[i] === "--help" || args[i] === "-h") {
    if (!IS_MAIN) continue;
    console.log(`
Usage: ${APP_NAME} [options]

Options:
  -p, --port <port>   Port to run the server (default: ${DEFAULT_PORT})
  -H, --host <host>   Host to bind (default: ${DEFAULT_HOST})
  -n, --no-browser    Don't open browser automatically
  -l, --log           Show server logs (default: hidden)
  -t, --tray          Run in system tray mode (background)
  --skip-update       Skip auto-update check
  -h, --help          Show this help message
  -v, --version       Show version

Commands:
  xai video --prompt "..." --output video.mp4
                      Generate a Grok Imagine video via the running gateway
                      (see: ${APP_NAME} xai video --help)
`);
    process.exit(0);
  } else if (args[i] === "--version" || args[i] === "-v") {
    if (!IS_MAIN) continue;
    console.log(pkg.version);
    process.exit(0);
  }
}

// Auto-relaunch after update: detached process has no TTY → fallback to tray
if (IS_MAIN && skipUpdate && !trayMode && !process.stdin.isTTY) {
  trayMode = true;
  process.env.TRAY_MODE = "1";
}

// Always use Node.js runtime with absolute path
const RUNTIME = process.execPath;

// Compare semver versions: returns 1 if a > b, -1 if a < b, 0 if equal
// Compare by numeric base only. A fork build carries a prerelease suffix
// ("0.5.76-enhanced"), and Number("76-enhanced") is NaN — every comparison with
// it is false, so this silently answered "same version" for ANY upstream
// release. That happened to be safe, but by accident; the rule is explicit now.
function compareVersions(a, b) {
  const parts = (v) => String(v).split("-")[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
  const partsA = parts(a);
  const partsB = parts(b);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

// This build carries a fork suffix (e.g. "0.5.76-enhanced"). The update notice
// still shows — knowing upstream released something is useful — but the command
// it prints installs the OFFICIAL package, which replaces the fork, so the
// screen says so instead of letting it look like a routine upgrade.
function isForkBuild(version) {
  return String(version).includes("-");
}

// Get app data dir (matches app/src/lib/dataDir.js convention)
function getAppDataDir() {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || "", "9router")
    : path.join(os.homedir(), ".9router");
}

// Server log sink.
//
// The server's stdout used to be sent to /dev/null ("ignore"), which is why a
// routing incident could not be diagnosed after the fact: every decision the
// gateway logs (account fallback, "at capacity", combo member attempts) existed
// only in a stream nobody read. It is NOT forwarded to our own stdout because
// the tray/TUI owns the terminal — it goes to a capped file instead.
const SERVER_LOG_MAX_BYTES = 8 * 1024 * 1024;

function openServerLogSink() {
  let fd = null;
  let written = 0;
  const file = path.join(getAppDataDir(), "server.log");

  const rotate = () => {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > SERVER_LOG_MAX_BYTES) {
        fs.renameSync(file, `${file}.1`);
      }
    } catch { /* best effort */ }
  };

  const open = () => {
    try {
      fs.mkdirSync(getAppDataDir(), { recursive: true });
      rotate();
      written = fs.existsSync(file) ? fs.statSync(file).size : 0;
      fd = fs.openSync(file, "a");
    } catch {
      fd = null;
    }
  };

  open();

  return {
    // Synchronous on purpose. A buffered stream loses whatever is still queued
    // when the launcher calls process.exit() after the server closes — and the
    // shutdown lines, the ones worth having, are the last ones written. The
    // launcher is a supervisor doing nothing else, so the blocking cost is fine.
    write(chunk) {
      if (fd === null) return;
      try {
        fs.writeSync(fd, chunk);
        written += chunk.length;
        if (written > SERVER_LOG_MAX_BYTES) {
          try { fs.closeSync(fd); } catch { /* best effort */ }
          fd = null;
          open();
        }
      } catch {
        // Disk full / fd gone: stop logging, never take the launcher down.
        try { if (fd !== null) fs.closeSync(fd); } catch { /* best effort */ }
        fd = null;
      }
    },
    path: file,
  };
}

// Kill PID from file (best-effort, removes file after)
function killByPidFile(pidFile) {
  try {
    if (!fs.existsSync(pidFile)) return;
    const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    if (!pid) return;
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 3000 });
      } else {
        process.kill(pid, "SIGKILL");
      }
    } catch { }
    try { fs.unlinkSync(pidFile); } catch { }
  } catch { }
}

// Kill tunnel processes (cloudflared/tailscale) by their PID files
function killTunnelByPidFile() {
  const tunnelDir = path.join(getAppDataDir(), "tunnel");
  killByPidFile(path.join(tunnelDir, "cloudflared.pid"));
  killByPidFile(path.join(tunnelDir, "tailscale.pid"));
}

// Kill cloudflared whose --url targets this app's port (covers stale PID file case)
function killCloudflaredByAppPort(appPort) {
  if (!appPort) return [];
  const portMatchers = [`localhost:${appPort}`, `127.0.0.1:${appPort}`];
  const pids = [];
  try {
    if (process.platform === "win32") {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "Get-WmiObject Win32_Process -Filter 'Name=\\"cloudflared.exe\\"' | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"`;
      const output = execSync(psCmd, { encoding: "utf8", windowsHide: true, timeout: 5000 });
      const lines = output.split("\n").slice(1).filter(l => l.trim());
      lines.forEach(line => {
        if (portMatchers.some(m => line.includes(m))) {
          const match = line.match(/^"(\d+)"/);
          if (match && match[1]) pids.push(match[1]);
        }
      });
    } else {
      const output = execSync("ps -eo pid,command 2>/dev/null", { encoding: "utf8", timeout: 5000 });
      output.split("\n").forEach(line => {
        if (line.includes("cloudflared") && portMatchers.some(m => line.includes(m))) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[0];
          if (pid && !isNaN(pid)) pids.push(pid);
        }
      });
    }
  } catch { }
  return pids;
}

// Kill all 9router processes → replaced by the ownership matcher +
// terminatePidsGracefully above (F23/T1.6 M1+M2): ask (SIGTERM) foreign
// instances first, wait SHUTDOWN_GRACE_MS, SIGKILL only survivors, and only
// for processes this installation provably owns.

// Sleep helper using SharedArrayBuffer wait (sync, no busy-loop)
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* ignore */ }
}

// Wait until process dies or timeout reached
function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    sleepSync(100);
  }
  return false;
}

// Kill MIT server by PID file (runs privileged, needs special handling)
// Sends SIGTERM first so MIT can clean up host entries before dying.
function killProxyByPidFile() {
  try {
    const pidFile = path.join(getAppDataDir(), "mitm", ".mitm.pid");
    if (!fs.existsSync(pidFile)) return;
    const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    if (!pid) return;

    if (process.platform === "win32") {
      // Graceful first (lets server cleanup hosts), then force
      try { execSync(`taskkill /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 2000 }); } catch { }
      if (!waitForExit(pid, 1500)) {
        try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 3000 }); } catch { }
      }
      // Last-resort: PowerShell Stop-Process (sometimes succeeds where taskkill fails on admin processes)
      if (!waitForExit(pid, 500)) {
        try { execSync(`powershell -NonInteractive -WindowStyle Hidden -Command "Stop-Process -Id ${pid} -Force"`, { stdio: "ignore", windowsHide: true, timeout: 3000 }); } catch { }
      }
    } else {
      // SIGTERM via cached sudo token first
      try { execSync(`sudo -n kill -TERM ${pid} 2>/dev/null`, { stdio: "ignore", timeout: 2000 }); }
      catch { try { process.kill(pid, "SIGTERM"); } catch { } }
      if (!waitForExit(pid, 1500)) {
        try { execSync(`sudo -n kill -9 ${pid} 2>/dev/null`, { stdio: "ignore", timeout: 2000 }); }
        catch { try { process.kill(pid, "SIGKILL"); } catch { } }
      }
    }
    try { fs.unlinkSync(pidFile); } catch { }
  } catch { }
}

// Kill any process on specific port → replaced by killProcessOnPort above
// (F23/T1.6 M1+M2): LISTEN sockets only (`lsof -sTCP:LISTEN` / netstat rows
// filtered to LISTENING + local address, not `lsof -ti:PORT` which also
// matches clients), ask-shutdown-then-kill, and a bounded port-release poll
// instead of the blind `kill -9` + fixed 500 ms sleep.


// Detect if running in restricted environment (Codespaces, Docker)
function isRestrictedEnvironment() {
  // Check for Codespaces
  if (process.env.CODESPACES === "true" || process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    return "GitHub Codespaces";
  }

  // Check for Docker
  if (fs.existsSync("/.dockerenv") || (fs.existsSync("/proc/1/cgroup") && fs.readFileSync("/proc/1/cgroup", "utf8").includes("docker"))) {
    return "Docker";
  }

  return null;
}

// Check if new version available, return latest version or null
function checkForUpdate() {
  return new Promise((resolve) => {
    if (skipUpdate) {
      resolve(null);
      return;
    }

    const spinner = createSpinner("Checking for updates...").start();
    let resolved = false;

    const safetyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        spinner.stop();
        resolve(null);
      }
    }, 8000);

    const done = (version) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(safetyTimeout);
      spinner.stop();
      resolve(version);
    };

    const req = https.get(`https://registry.npmjs.org/${pkg.name}/latest`, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const latest = JSON.parse(data);
          if (latest.version && compareVersions(latest.version, pkg.version) > 0) {
            done(latest.version);
          } else {
            done(null);
          }
        } catch (e) {
          done(null);
        }
      });
    });

    req.on("error", () => done(null));
    req.on("timeout", () => { req.destroy(); done(null); });
  });
}

// Open browser
function openBrowser(url) {
  const platform = process.platform;
  let cmd;

  if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else if (platform === "win32") {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, { windowsHide: true }, (err) => {
    if (err) {
      console.log(`Open browser manually: ${url}`);
    }
  });
}

// Find standalone server (bundled in bin/app for published package).
// Prefer custom-server.js (injects real socket IP) when present.
const standaloneDir = path.join(__dirname, "app");
const customServerPath = path.join(standaloneDir, "custom-server.js");
const serverPath = fs.existsSync(customServerPath)
  ? customServerPath
  : path.join(standaloneDir, "server.js");

if (IS_MAIN && !fs.existsSync(serverPath)) {
  console.error("Error: Standalone build not found.");
  console.error("Please run 'npm run build:cli' first.");
  process.exit(1);
}

// F23/T1.6 M1: the restart path (running `9router` again while an old instance
// lives). Both steps used to SIGKILL on sight, discarding the drain the
// CHANGELOG's 8 s budget exists to protect. They now ask-shutdown-then-kill:
// SIGTERM → wait up to SHUTDOWN_GRACE_MS → SIGKILL only survivors, and only
// processes this installation provably owns (exact paths / cwd / LISTEN owner).
if (IS_MAIN) {
  // Start server immediately; run update check in parallel (not on the critical path).
  const updatePromise = checkForUpdate();
  killAllAppProcesses(port)
    .then(() => killProcessOnPort(port))
    .then(() => startServer(updatePromise));
}

// Show interface selection menu
async function showInterfaceMenu(latestVersion) {
  const { selectMenu } = require("./src/cli/utils/input");
  const { clearScreen } = require("./src/cli/utils/display");
  const { getEndpoint } = require("./src/cli/utils/endpoint");

  clearScreen();

  const displayHost = getDisplayHost();

  // Detect tunnel/local mode for server URL display
  let serverUrl;
  try {
    const { endpoint, tunnelEnabled } = await getEndpoint(port);
    serverUrl = tunnelEnabled ? endpoint.replace(/\/v1$/, "") : `http://${displayHost}:${port}`;
  } catch (e) {
    serverUrl = `http://${displayHost}:${port}`;
  }

  const subtitle = `🚀 Server: \x1b[32m${serverUrl}\x1b[0m`;

  const menuItems = [];

  if (latestVersion) {
    menuItems.push({ label: `Update to v${latestVersion} (current: v${pkg.version})`, icon: "⬆" });
  }

  menuItems.push(
    { label: "Web UI (Open in Browser)", icon: "🌐" },
    { label: "Terminal UI (Interactive CLI)", icon: "💻" },
    { label: "Hide to Tray (Background)", icon: "🔔" },
    { label: "Exit", icon: "🚪" }
  );

  const selected = await selectMenu(`Choose Interface (v${pkg.version})`, menuItems, 0, subtitle);

  const offset = latestVersion ? 1 : 0;

  if (latestVersion && selected === 0) return "update";
  if (selected === offset) return "web";
  if (selected === offset + 1) return "terminal";
  if (selected === offset + 2) return "hide";
  return "exit";
}

const MAX_RESTARTS = 2;
const RESTART_RESET_MS = 30000; // Reset counter if alive > 30s

function startServer(updatePromise) {
  // Accept either a Promise (parallel update check) or a resolved value.
  const latestVersionPromise = Promise.resolve(updatePromise);
  const displayHost = getDisplayHost();
  const url = `http://${displayHost}:${port}/dashboard`;
  // Surface real network exposure when bound to all interfaces (default 0.0.0.0).
  if (host === DEFAULT_HOST) {
    const lanIp = getLanIp();
    if (lanIp) console.log(`\x1b[33m⚠ Network-exposed: reachable at http://${lanIp}:${port} (bound 0.0.0.0). Use --host 127.0.0.1 for local-only.\x1b[0m`);
  }

  let restartCount = 0;
  let serverStartTime = Date.now();

  const CRASH_LOG_LINES = 50;
  let crashLog = [];

  function spawnServer() {
    serverStartTime = Date.now();
    crashLog = [];
    const child = spawn(RUNTIME, ["--dns-result-order=ipv4first", "--max-old-space-size=6144", serverPath], {
      cwd: standaloneDir,
      stdio: showLog ? "inherit" : ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: true,
      env: {
        ...buildEnvWithRuntime(process.env),
        PORT: port.toString(),
        HOSTNAME: host
      }
    });
    if (!showLog) {
      const sink = openServerLogSink();
      if (child.stdout) child.stdout.on("data", (data) => sink.write(data));
      if (child.stderr) {
        child.stderr.on("data", (data) => {
          sink.write(data);
          const lines = data.toString().split("\n").filter(Boolean);
          crashLog.push(...lines);
          if (crashLog.length > CRASH_LOG_LINES) crashLog = crashLog.slice(-CRASH_LOG_LINES);
        });
      }
    }
    return child;
  }

  let server = spawnServer();

  // Server shutdown budget lives at module scope now (SHUTDOWN_GRACE_MS,
  // F23/M1) so the restart path (killAllAppProcesses / killProcessOnPort)
  // asks foreign instances nicely with the SAME grace window we use for our
  // own child below.

  // The server is spawned detached, so it leads its own process group: a signal
  // to -pid reaches it and its children exactly once. Signalling pid AND -pid
  // would deliver twice and read as "user asked again, hurry up".
  function signalServer(sig) {
    if (!server || !server.pid) return false;
    try {
      process.kill(-server.pid, sig);
      return true;
    } catch (e) {
      try { process.kill(server.pid, sig); return true; } catch (e2) { return false; }
    }
  }

  // Cleanup function - stop the server, gracefully unless told otherwise
  let isCleaningUp = false;
  // F23/M5: killTray() returns a promise that waits for the Go tray binary to
  // actually exit (its own 800/1600 ms escalation + 3 s poll). Fire-and-forget
  // in an exit path that calls process.exit() on the same tick never lets that
  // run — the documented ghost-NSStatusItem condition. Paths that are about to
  // exit await this promise via awaitTrayExit().
  let trayKillPromise = null;
  function awaitTrayExit(boundMs = TRAY_EXIT_BOUND_MS) {
    if (!trayKillPromise) return Promise.resolve(true);
    return settleWithBound(trayKillPromise, boundMs);
  }

  // F23/M5: set while the "Hide to Tray" handoff is awaiting the server's
  // drain — the server "close" handler must NOT process.exit() behind the
  // handoff chain's back (that is how the tray was skipped before).
  let handoffToTray = false;
  async function handoffToBackgroundTray() {
    handoffToTray = false;
    const bgProcess = spawn(process.execPath, ["--dns-result-order=ipv4first", __filename, "--tray", "--skip-update", "-p", port.toString()], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env }
    });
    bgProcess.unref();
    console.log(`🔔 9Router is now running in background (PID: ${bgProcess.pid})`);
    console.log(`   Server: http://${displayHost}:${port}`);
    console.log(`\n💡 You can close this terminal. Right-click tray icon to quit.\n`);
    // Bound: killTray() escalates at 800/1600 ms and polls ~3 s; a wedged Go
    // binary must not hold the launcher open forever.
    await awaitTrayExit();
    process.exit(0);
  }
  function cleanup({ graceful = true } = {}) {
    if (isCleaningUp) return;
    isCleaningUp = true;
    try {
      // Kill tray if running
      try {
        const { killTray } = require("./src/cli/tray/tray");
        trayKillPromise = killTray();
      } catch (e) { }
      // Kill MIT server (privileged process) via PID file
      killProxyByPidFile();
      // Kill cloudflared/tailscale via PID file (only this app's tunnel)
      killTunnelByPidFile();

      if (!graceful) {
        signalServer("SIGKILL");
        return;
      }

      // Ask first. server.on("close") exits this process with the server's own
      // code once it is done; the timer below is the escalation if it wedges.
      if (signalServer("SIGTERM")) {
        forceKillTimer = setTimeout(() => {
          console.error(`\n⚠️  Server did not exit in ${SHUTDOWN_GRACE_MS / 1000}s — forcing.`);
          signalServer("SIGKILL");
        }, SHUTDOWN_GRACE_MS);
      }
    } catch (e) { }
  }

  let forceKillTimer = null;

  // Last resort: if the server is already gone (no "close" to wait for), still exit.
  function exitAfterServerStops(code = 0) {
    setTimeout(() => process.exit(code), SHUTDOWN_GRACE_MS + 2000);
  }

  // Stop the server and resolve once it is actually gone — for callers that
  // must reclaim the port or the DB right after.
  function stopServerGracefully() {
    return new Promise((resolve) => {
      if (!server || !server.pid || server.exitCode !== null) return resolve();
      const done = () => { if (forceKillTimer) clearTimeout(forceKillTimer); resolve(); };
      server.once("close", done);
      cleanup();
      setTimeout(done, SHUTDOWN_GRACE_MS + 500);
    });
  }

  // Suppress all errors during shutdown (systray lib throws JSON parse errors)
  let isShuttingDown = false;
  process.on("uncaughtException", (err) => {
    if (isShuttingDown) return;
    console.error("Error:", err.message);
  });

  // Handle all exit scenarios
  process.on("SIGINT", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("\nExiting...");
    cleanup();
    exitAfterServerStops();
  });
  process.on("SIGTERM", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    cleanup();
    exitAfterServerStops();
  });
  process.on("SIGHUP", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    cleanup();
    exitAfterServerStops();
  });

  // Initialize tray icon (runs alongside TUI)
  const initTrayIcon = () => {
    try {
      const { initTray } = require("./src/cli/tray/tray");
      initTray({
        port,
        onQuit: () => {
          isShuttingDown = true;
          console.log("\n👋 Shutting down from tray...");
          cleanup();
          exitAfterServerStops();
        },
        onOpenDashboard: () => openBrowser(url)
      });
    } catch (err) {
      // Tray not available - continue without it
    }
  };

  // Tray-only mode: no TUI, just tray icon
  if (trayMode) {
    // Ignore SIGHUP so macOS terminal close doesn't kill the background tray process
    process.removeAllListeners("SIGHUP");
    process.on("SIGHUP", () => {});

    console.log(`\n🚀 ${pkg.name} v${pkg.version}`);
    console.log(`Server: http://${displayHost}:${port}`);

    waitServerReady(port).then(() => {
      initTrayIcon();
      console.log("\n💡 Router is now running in system tray. Close this terminal if you want.");
      console.log("   Right-click tray icon to open dashboard or quit.\n");
    });

    return;
  }

  // Wait for server to be ready, then show interface menu loop + tray
  waitServerReady(port).then(async () => {
    // Resolve parallel update check (already running); don't block server start on it.
    const latestVersion = await latestVersionPromise;
    // Start tray icon alongside TUI
    initTrayIcon();

    try {
      while (true) {
        const choice = await showInterfaceMenu(latestVersion);

        if (choice === "update") {
          isShuttingDown = true;
          const { clearScreen } = require("./src/cli/utils/display");
          clearScreen();
          console.log(`\n⬆  Update v${pkg.version} → v${latestVersion}\n`);
          if (isForkBuild(pkg.version)) {
            console.log(`\x1b[33m⚠ This is the ${pkg.version} fork. The command below installs the OFFICIAL`);
            console.log(`  package and replaces it — merge upstream into the fork instead.\x1b[0m\n`);
          }
          console.log(`Run this after exit:\n`);
          console.log(`   \x1b[33m${INSTALL_CMD_LATEST}\x1b[0m\n`);
          await stopServerGracefully();
          await killAllAppProcesses(port);
          await killProcessOnPort(port);
          // F23/M5: let the Go tray binary finish dying (killTray() promise was
          // started by cleanup() inside stopServerGracefully) before the exit —
          // the fixed 200 ms timer used to cut its 800/1600 ms escalation off.
          await awaitTrayExit();
          setTimeout(() => process.exit(0), 200);
          return;
        } else if (choice === "web") {
          openBrowser(url);
          // Wait for user to come back
          const { pause } = require("./src/cli/utils/input");
          await pause("\nPress Enter to go back to menu...");
        } else if (choice === "terminal") {
          // Start Terminal UI - it will return when user selects Back
          const { startTerminalUI } = require("./src/cli/terminalUI");
          await startTerminalUI(port);
          // Loop continues, show menu again
        } else if (choice === "hide") {
          const { clearScreen } = require("./src/cli/utils/display");
          clearScreen();

          // F23/T1.6 M7: this used to call enableAutoStart() on every hide —
          // silently installing a boot agent (a 9router --tray process binding
          // 0.0.0.0 with the default password, restarting at every login) from
          // a menu item whose label says only "Hide to Tray". Auto-start has
          // an explicit toggle in the tray menu ("Enable Auto-start"); the
          // launcher does not presume it anymore.

          if (process.platform === "darwin") {
            // macOS: keep current process alive — spawning a detached child puts
            // it outside the login session so NSStatusItem silently fails.
            process.removeAllListeners("SIGHUP");
            process.on("SIGHUP", () => {});

            console.log(`\n⏳ Switching to tray mode... (icon already visible in menu bar)`);
            console.log(`🔔 9Router is running in tray (PID: ${process.pid})`);
            console.log(`   Server: http://${displayHost}:${port}`);
            console.log(`\n💡 You can close this terminal. Right-click tray icon to quit.\n`);

            // Tray already init'd at startup — just keep event loop alive.
            return;
          }

          // Windows/Linux: hand off to a detached background process.
          // F23/T1.6 M1+M5: the old code SIGKILLed the server outright (the
          // one path the CHANGELOG's 8 s drain does NOT cover) and called
          // process.exit() on the same tick as cleanup(), so killTray()'s
          // promise never ran and the child re-registered an icon over a
          // still-alive Go process (ghost/duplicate NSStatusItem). Now: stop
          // our server with the same graceful helper the "exit" path uses,
          // THEN spawn the child so it never races our port, and wait (bound)
          // for the tray binary to die before leaving.
          console.log(`\n⏳ Draining server and handing off to background process...`);
          isShuttingDown = true;
          handoffToTray = true; // server "close" must not exit() behind our back
          await stopServerGracefully();
          await handoffToBackgroundTray();
          return;
        } else if (choice === "exit") {
          isShuttingDown = true;
          console.log("\nExiting...");
          cleanup();
          exitAfterServerStops();
        }
      }
    } catch (err) {
      console.error("Error:", err.message);
      cleanup({ graceful: false });
      await awaitTrayExit(); // F23/M5: bounded — never hold the launcher open for a wedged tray
      process.exit(1);
    }
  });

  function attachServerEvents() {
    server.on("error", (err) => {
      console.error("Failed to start server:", err.message);
      if (!isShuttingDown) tryRestart();
      // F23/M5: same exit race as the menu path — wait (bounded) for the tray
      // binary the cleanup() started to release before leaving.
      else { cleanup({ graceful: false }); awaitTrayExit().then(() => process.exit(1)); }
    });

    server.on("close", (code) => {
      if (forceKillTimer) { clearTimeout(forceKillTimer); forceKillTimer = null; }
      // Hide-to-tray handoff in flight: the handoff chain (stopServerGracefully
      // → handoffToBackgroundTray) owns the exit now. Exiting here would skip
      // the tray-await and re-create the ghost-icon race (F23/M5).
      if (handoffToTray) return;
      if (isShuttingDown || code === 0) {
        process.exit(code || 0);
        return;
      }
      tryRestart(code);
    });
  }

  function tryRestart(code) {
    const aliveMs = Date.now() - serverStartTime;
    // Reset counter if last run was stable
    if (aliveMs >= RESTART_RESET_MS) restartCount = 0;

    if (restartCount >= MAX_RESTARTS) {
      // F23/T1.6 M6: this block used to rewrite settings.mitmEnabled=false in
      // ~/.9router/db.json. That file has been dead storage since the SQLite
      // cutover (src/lib/db/: the server imports legacy db.json ONCE at boot,
      // then reads settings from data.sqlite), so the "Disabling MIT" message
      // was a lie: on a fresh install the file does not exist (existsSync →
      // false, swallowed by catch), and on a migrated install the file still
      // exists but is never read again — MIT stays enabled either way.
      // The launcher deliberately does NOT reach into the server's SQLite
      // instead: the crashing server (or its just-spawned replacement) owns
      // that DB, the launcher has no SQLite dependency (engines.node >= 18
      // predates node:sqlite), and a hand-rolled UPDATE would bypass the
      // repo layer that owns the schema. MITM crash-loop relief belongs in
      // the server (it detects and can disable its own MITM); the launcher
      // only restarts and says so honestly.
      console.error(`\n⚠️  Server crashed ${MAX_RESTARTS} times. Restarting. If crashes persist (e.g. after enabling MITM), disable it in the dashboard Settings — the launcher no longer edits server state.`);
      restartCount = 0;
      server = spawnServer();
      attachServerEvents();
      return;
    }

    restartCount++;
    const delay = Math.min(1000 * restartCount, 10000);
    console.error(`\n⚠️  Server exited (code=${code ?? "unknown"}). Restarting in ${delay / 1000}s... (${restartCount}/${MAX_RESTARTS})`);
    if (crashLog.length) {
      console.error("\n--- Server crash log ---");
      crashLog.forEach(l => console.error(l));
      console.error("--- End crash log ---\n");
    }

    setTimeout(() => {
      server = spawnServer();
      attachServerEvents();
    }, delay);
  }

  attachServerEvents();
}

// F23/T1.6: exported for unit tests (tests/unit/f23-*.test.js). Requiring this
// file is inert — the IS_MAIN guards above keep the launcher flow to the entry
// point so a test host can never be ps-scanned-and-killed by `import`.
module.exports = {
  isOwnAppProcess,
  collectOwnAppPids,
  cmdContainsExactPath,
  parsePidCommand,
  parseWmiCsvEntry,
  terminatePidsGracefully,
  settleWithBound,
  parseLsofListenerPids,
  parseNetstatListenerPids,
  killAllAppProcesses,
  killProcessOnPort,
  compareVersions,
  isForkBuild,
  SHUTDOWN_GRACE_MS,
};
