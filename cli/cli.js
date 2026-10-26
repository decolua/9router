#!/usr/bin/env node

const { spawn, exec, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Startup readiness/failure detection (DF-9ROUTER-18) and port resolution
// (DF-9ROUTER-28) live in ./src/cli/utils/serverStartup so they are
// unit-testable: an occupied port is refused BEFORE spawning, readiness requires
// the 9router identity probe (not just an open socket), an early child exit is a
// hard failure, and the port comes from `--port/-p` → `PORT` → the default
// (DEFAULT_PORT is imported — this file no longer holds the port literal).
const {
  DEFAULT_PORT,
  checkPortAvailable,
  describeOccupiedPort,
  describeStartupFailure,
  resolvePort,
  waitForServerReady,
} = require("./src/cli/utils/serverStartup");
const { checkForUpdate } = require("./src/cli/utils/updateCheck");

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

// Subcommands (`9router xai video …`) run against an already-running gateway
// and bypass the launcher flow (no runtime self-heal, no server spawn).
if (args[0] === "xai" && args[1] === "video") {
  const { run } = require("./src/cli/commands/xaiVideo");
  run(args.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`❌ ${err?.message || err}`);
      process.exit(1);
    });
  return;
}

// `9router connect <url>` configures local CLI tools against a remote server, and
// `9router show` prints what they're currently set to — no local server, no
// runtime deps. Usable via `npx 9router …`.
if (args[0] === "connect" || args[0] === "show") {
  const { run } = require(args[0] === "show" ? "./src/cli/commands/show" : "./src/cli/commands/connect");
  run(args.slice(1))
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
try { ensureSqliteRuntime({ silent: true }); } catch {}

// Headless escape (DF-9ROUTER-64): `--no-tray` must skip the tray lifecycle
// ENTIRELY — starting with this runtime install, which on a fresh headless host
// would otherwise spend a network `npm install systray2` on a tray that can
// never be initialized without a display. Parsed here (before the main arg
// loop) because the install runs before that loop; the loop below re-sets the
// same variable so the flag is handled like every other one.
const noTrayRequested = args.includes("--no-tray");

// Self-heal tray runtime (systray for macOS/Linux only). Windows skipped.
// Skipped under --no-tray (DF-9ROUTER-64): no tray is ever initialized on the
// headless path, so none of its runtime is installed either.
if (!noTrayRequested) {
  try { ensureTrayRuntime({ silent: true }); } catch {}
}

// Configuration constants
const APP_NAME = pkg.name; // Use from package.json

const DEFAULT_HOST = "0.0.0.0";

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
// Identifiers for killAllAppProcesses - only kill 9router specifically
const PROCESS_IDENTIFIERS = [
  '9router'  // Only package name - avoid killing other apps
];

// Parse arguments. The port is only COLLECTED here — what it means (flag beats
// env beats default, and what an unusable value does) is decided by
// resolvePort() right below (DF-9ROUTER-28).
let argPort = null;
let host = DEFAULT_HOST;
let noBrowser = false;
let skipUpdate = false;
let showLog = false;
let trayMode = false;
// Headless escape (DF-9ROUTER-64): set by `--no-tray`. Default `false` — the
// interactive launcher behavior is unchanged when the flag is absent.
let noTray = noTrayRequested;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" || args[i] === "-p") {
    argPort = args[i + 1];
    i++;
  } else if (args[i] === "--host" || args[i] === "-H") {
    host = args[i + 1] || DEFAULT_HOST;
    i++;
  } else if (args[i] === "--no-browser" || args[i] === "-n") {
    noBrowser = true;
  } else if (args[i] === "--no-tray") {
    noTray = true;
  } else if (args[i] === "--log" || args[i] === "-l") {
    showLog = true;
  } else if (args[i] === "--skip-update") {
    skipUpdate = true;
  } else if (args[i] === "--tray" || args[i] === "-t") {
    trayMode = true;
    process.env.TRAY_MODE = "1";
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
Usage: ${APP_NAME} [options]

Options:
  -p, --port <port>   Port to run the server (default: ${DEFAULT_PORT})
  -H, --host <host>   Host to bind (default: ${DEFAULT_HOST})
  -n, --no-browser    Don't open browser automatically
  --no-tray           Headless mode: skip tray/UI, serve in the foreground
  -l, --log           Show server logs (default: hidden)
  -t, --tray          Run in system tray mode (background)
  --skip-update       Skip auto-update check
  -h, --help          Show this help message
  -v, --version       Show version

Environment:
  PORT                Port to run the server when --port/-p is not given
                      (precedence: --port/-p → PORT → ${DEFAULT_PORT})

Commands:
  connect <server-url> Configure Claude Code for a remote 9router server
                      (npx 9router connect http://host:20128 — no install needed)
  show [tool…]        Show each CLI tool's current 9router config and models
                      (e.g. 9router show claude)
  xai video --prompt "..." --output video.mp4
                      Generate a Grok Imagine video via the running gateway
                      (see: ${APP_NAME} xai video --help)
`);
    process.exit(0);
  } else if (args[i] === "--version" || args[i] === "-v") {
    console.log(pkg.version);
    process.exit(0);
  }
}

// Resolve the port (DF-9ROUTER-28) — `--port/-p` → `PORT` → the default
// (DEFAULT_PORT, imported from the same module). `port` is the single source of
// truth from here on: it seeds the tray relaunch, the pre-flight probe, the
// child's env, and every URL printed.
// An unusable PORT is reported (never silently overridden); an unusable --port
// falls through (its legacy behavior — never an error).
const { port, warning: portWarning } = resolvePort({ argPort });
if (portWarning) console.error(portWarning);

// Auto-relaunch after update: detached process has no TTY → fallback to tray.
// `--no-tray` opts out (DF-9ROUTER-64): a headless operator asked for the
// foreground server, and a launcher that silently flips itself into the
// tray/background path is exactly the untraceable lifecycle this flag escapes.
if (skipUpdate && !trayMode && !noTray && !process.stdin.isTTY) {
  trayMode = true;
  process.env.TRAY_MODE = "1";
}

// Loud exits (DF-9ROUTER-64): published-package instances on headless hosts were
// found dying with zero output — no log line, no kernel OOM, nothing to grep.
// Every lifecycle exit now writes one timestamped line to stderr FIRST, so even
// a launcher whose stdout was never attached to anything leaves a trace.
function logExit(reason, detail) {
  try {
    const parts = [`[${new Date().toISOString()}]`, "[9router]", "exiting:", reason];
    if (detail !== undefined) parts.push(JSON.stringify(detail));
    process.stderr.write(`${parts.join(" ")}\n`);
  } catch { /* a dying process must never die because logging died */ }
}

// Always use Node.js runtime with absolute path
const RUNTIME = process.execPath;

// Get app data dir (matches app/src/lib/dataDir.js convention)
function getAppDataDir() {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || "", "9router")
    : path.join(os.homedir(), ".9router");
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

// Kill all 9router processes
function killAllAppProcesses(appPort) {
  return new Promise((resolve) => {
    try {
      // Background: MITM + tunnel/cloudflared run on separate ports/processes —
      // killing them doesn't free the app port, so don't block the critical path.
      // Server-side MITM manager has stale-lock recovery and starts deferred (~3s).
      setImmediate(() => {
        try { killProxyByPidFile(); } catch {}
        try { killTunnelByPidFile(); } catch {}
        try { killCloudflaredByAppPort(appPort); } catch {}
      });

      const platform = process.platform;
      let pids = [];

      if (platform === "win32") {
        // Windows: use WMI to get full CommandLine (tasklist /V doesn't include it)
        try {
          const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "Get-WmiObject Win32_Process -Filter 'Name=\\"node.exe\\"' | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"`;
          const output = execSync(psCmd, {
            encoding: "utf8",
            windowsHide: true,
            timeout: 5000
          });
          const lines = output.split("\n").slice(1).filter(l => l.trim());
          lines.forEach(line => {
            // Whitelist: real node process running 9router/cli.js, or next-server.
            // Avoids killing editors/grep/strace/cursor that just have "9router" in cmdline.
            const cmd = line.toLowerCase();
            const isAppProcess =
              (cmd.includes("node") && cmd.includes("9router") && (cmd.includes("cli.js") || cmd.includes("\\9router") || cmd.includes("/9router")))
              || cmd.includes("next-server");
            if (isAppProcess) {
              const match = line.match(/^"(\d+)"/);
              if (match && match[1] && match[1] !== process.pid.toString()) {
                pids.push(match[1]);
              }
            }
          });
        } catch (e) {
          // No processes found or error - continue
        }
      } else {
        // macOS/Linux: use ps to find all matching processes
        try {
          const output = execSync('ps aux 2>/dev/null', {
            encoding: 'utf8',
            timeout: 5000
          });
          const lines = output.split('\n');

          lines.forEach(line => {
            // Whitelist: real node process running 9router/cli.js, or next-server.
            // Avoids killing grep/strace/editors/cursor that incidentally match "9router".
            const cmd = line.toLowerCase();
            const isAppProcess =
              (cmd.includes("node") && cmd.includes("9router") && (cmd.includes("cli.js") || cmd.includes("/9router")))
              || cmd.includes("next-server");
            if (isAppProcess) {
              const parts = line.trim().split(/\s+/);
              const pid = parts[1];
              if (pid && !isNaN(pid) && pid !== process.pid.toString()) {
                pids.push(pid);
              }
            }
          });
        } catch (e) {
          // No processes found or error - continue
        }
      }

      // Kill all found processes
      if (pids.length > 0) {
        pids.forEach(pid => {
          try {
            if (platform === "win32") {
              execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore', shell: true, windowsHide: true, timeout: 3000 });
            } else {
              execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 });
            }
          } catch (err) {
            // Process already dead or can't kill - continue
          }
        });

        // Wait for processes to fully terminate
        setTimeout(() => resolve(), 1000);
      } else {
        resolve();
      }
    } catch (err) {
      // Silent fail - continue anyway
      resolve();
    }
  });
}

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

// Kill any process on specific port
function killProcessOnPort(port) {
  return new Promise((resolve) => {
    try {
      const platform = process.platform;
      let pid;

      if (platform === "win32") {
        try {
          const output = execSync(`netstat -ano | findstr :${port}`, {
            encoding: 'utf8',
            shell: true,
            windowsHide: true,
            timeout: 5000
          }).trim();
          const lines = output.split('\n').filter(l => l.includes('LISTENING'));
          if (lines.length > 0) {
            pid = lines[0].trim().split(/\s+/).pop();
            execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore', shell: true, windowsHide: true, timeout: 3000 });
          }
        } catch (e) {
          // Port is free or error
        }
      } else {
        // macOS/Linux
        try {
          const pidOutput = execSync(`lsof -ti:${port}`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore']
          }).trim();
          if (pidOutput) {
            pid = pidOutput.split('\n')[0];
            execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 });
          }
        } catch (e) {
          // Port is free or error
        }
      }

      // Wait for port to be released
      setTimeout(() => resolve(), 500);
    } catch (err) {
      // Silent fail - continue anyway
      resolve();
    }
  });
}


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

if (!fs.existsSync(serverPath)) {
  console.error("Error: Standalone build not found.");
  console.error("Please run 'npm run build:cli' first.");
  process.exit(1);
}

// Start server immediately; run update check in parallel (not on the critical path).
const updatePromise = checkForUpdate({ pkg, skipUpdate, createSpinner });
killAllAppProcesses(port)
  .then(() => killProcessOnPort(port))
  // Pre-flight (DF-9ROUTER-18): the cleanup above is best-effort — a port we
  // could not free (held by another user, published by docker, lsof missing)
  // would make the child we are about to spawn die with EADDRINUSE. Refuse
  // instead of starting a doomed child and reporting a healthy start.
  .then(() => checkPortAvailable({ port }))
  .then((portState) => {
    if (!portState.ok) {
      console.error(describeOccupiedPort(port, portState));
      process.exit(1);
    }
    startServer(updatePromise);
  })
  // A throw anywhere in the launch path must still be a loud, non-zero exit —
  // never a launcher that silently does nothing.
  .catch((err) => {
    console.error(`❌ Startup failed: ${err?.message || err}`);
    process.exit(1);
  });

// Show interface selection menu
async function showInterfaceMenu(updateOffer) {
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

  if (updateOffer) {
    menuItems.push({ label: updateOffer.label, icon: "⬆" });
  }

  menuItems.push(
    { label: "Web UI (Open in Browser)", icon: "🌐" },
    { label: "Terminal UI (Interactive CLI)", icon: "💻" },
    { label: "Hide to Tray (Background)", icon: "🔔" },
    { label: "Exit", icon: "🚪" }
  );

  const selected = await selectMenu(`Choose Interface (v${pkg.version})`, menuItems, 0, subtitle);

  const offset = updateOffer ? 1 : 0;

  if (updateOffer && selected === 0) return "update";
  if (selected === offset) return "web";
  if (selected === offset + 1) return "terminal";
  if (selected === offset + 2) return "hide";
  return "exit";
}

const MAX_RESTARTS = 2;
const RESTART_RESET_MS = 30000; // Reset counter if alive > 30s

function startServer(updatePromise) {
  // Accept either a Promise (parallel update check) or a resolved offer.
  const updateOfferPromise = Promise.resolve(updatePromise);
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

  // Flips true only once the readiness probe confirms OUR child is serving.
  // Before that, any child exit is a startup failure — never a silent restart.
  let serverReady = false;

  function spawnServer() {
    serverStartTime = Date.now();
    crashLog = [];
    const child = spawn(RUNTIME, ["--dns-result-order=ipv4first", "--max-old-space-size=6144", serverPath], {
      cwd: standaloneDir,
      stdio: showLog ? "inherit" : ["ignore", "ignore", "pipe"],
      detached: true,
      windowsHide: true,
      env: {
        ...buildEnvWithRuntime(process.env),
        PORT: port.toString(),
        HOSTNAME: host
      }
    });
    if (!showLog && child.stderr) {
      child.stderr.on("data", (data) => {
        const lines = data.toString().split("\n").filter(Boolean);
        crashLog.push(...lines);
        if (crashLog.length > CRASH_LOG_LINES) crashLog = crashLog.slice(-CRASH_LOG_LINES);
      });
    }
    return child;
  }

  let server = spawnServer();

  // ── Startup gate (DF-9ROUTER-18) ─────────────────────────────────────────
  // The launcher must never report success for a failed start. An early child
  // exit (EADDRINUSE and friends) or a readiness timeout is a hard failure with
  // a non-zero exit code — in every mode, including tray/background mode, which
  // has no other watcher on the child process.
  function printCrashLog() {
    if (!crashLog.length) return;
    console.error("\n--- Server crash log ---");
    crashLog.forEach((l) => console.error(l));
    console.error("--- End crash log ---\n");
  }

  function failStartup(result) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logExit("startup-failed", { port, result }); // loud BEFORE the report (DF-9ROUTER-64)
    console.error(`\n${describeStartupFailure(port, result)}`);
    printCrashLog();
    cleanup();
    process.exit(1);
  }

  // Cleanup function - force kill server process
  let isCleaningUp = false;
  function cleanup() {
    if (isCleaningUp) return;
    isCleaningUp = true;
    try {
      // Kill tray if running
      try {
        const { killTray } = require("./src/cli/tray/tray");
        killTray();
      } catch (e) { }
      // Kill MIT server (privileged process) via PID file
      killProxyByPidFile();
      // Kill cloudflared/tailscale via PID file (only this app's tunnel)
      killTunnelByPidFile();
      // Kill server process directly
      if (server.pid) {
        process.kill(server.pid, "SIGKILL");
      }
      // Also try to kill process group
      process.kill(-server.pid, "SIGKILL");
    } catch (e) { }
  }

  // Suppress all errors during shutdown (systray lib throws JSON parse errors).
  // The timestamped line below (DF-9ROUTER-64) makes sure an unexpected
  // uncaughtException still leaves a dated trace before being swallowed.
  let isShuttingDown = false;
  process.on("uncaughtException", (err) => {
    if (isShuttingDown) return;
    logExit("uncaught-exception", { message: err && err.message });
    console.error("Error:", err.message);
  });

  // Handle all exit scenarios
  process.on("SIGINT", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logExit("signal", { signal: "SIGINT" });
    console.log("\nExiting...");
    cleanup();
    setTimeout(() => process.exit(0), 100);
  });
  process.on("SIGTERM", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logExit("signal", { signal: "SIGTERM" });
    cleanup();
    setTimeout(() => process.exit(0), 100);
  });
  process.on("SIGHUP", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logExit("signal", { signal: "SIGHUP" });
    cleanup();
    setTimeout(() => process.exit(0), 100);
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
          setTimeout(() => process.exit(0), 100);
        },
        onOpenDashboard: () => openBrowser(url)
      });
    } catch (err) {
      // Tray not available - continue without it
    }
  };

  // Tray-only mode: no TUI, just tray icon. `--no-tray` takes precedence
  // (DF-9ROUTER-64): it is an escape hatch, so even a contradictory `-t` on the
  // same command line cannot push a headless launch back into the tray path.
  if (trayMode && !noTray) {
    // Ignore SIGHUP so macOS terminal close doesn't kill the background tray process
    process.removeAllListeners("SIGHUP");
    process.on("SIGHUP", () => {});

    console.log(`\n🚀 ${pkg.name} v${pkg.version}`);
    console.log(`Server: http://${displayHost}:${port}`);

    waitForServerReady({ port, child: server }).then((result) => {
      if (!result.ok) return failStartup(result);
      serverReady = true;
      initTrayIcon();
      console.log("\n💡 Router is now running in system tray. Close this terminal if you want.");
      console.log("   Right-click tray icon to open dashboard or quit.\n");
    });

    return;
  }

  // Headless escape (DF-9ROUTER-64): `--no-tray` serves in the FOREGROUND with
  // the whole tray/UI lifecycle skipped — no tray icon, no interface menu loop,
  // no TUI, no hide-to-tray relaunch, no enableAutoStart(). The launcher stays
  // alive only to supervise its child (readiness gate + restart policy below
  // still apply) and normal logging goes to the terminal. Unreachable without
  // the flag, so the default interactive behavior is unchanged.
  if (noTray) {
    console.log(`\n🚀 ${pkg.name} v${pkg.version} (headless)`);
    console.log(`Server: http://${displayHost}:${port}`);
    console.log(`Dashboard: ${url}`);
    console.log("Tray/UI disabled (--no-tray). Press Ctrl+C to stop.\n");

    waitForServerReady({ port, child: server }).then((result) => {
      if (!result.ok) return failStartup(result);
      serverReady = true;
      console.log(`[${new Date().toISOString()}] [9router] server ready on http://${displayHost}:${port}`);
    });

    return;
  }

  // Wait for server to be ready, then show interface menu loop + tray
  waitForServerReady({ port, child: server }).then(async (result) => {
    if (!result.ok) return failStartup(result);
    serverReady = true;

    // Non-TTY (piped stdin, CI runner, systemd unit): there is no user to
    // render a menu for — selectMenu() resolves before its first paint when
    // stdin is not a TTY, i.e. the documented outcome is "exit". Resolve that
    // HERE, before the interactive menu stack is loaded, so the promised
    // behavior holds even where that stack cannot be required: a source
    // checkout that never ran `npm --prefix cli install` has no
    // cli/node_modules, and showInterfaceMenu() throws
    // `Cannot find module 'node-machine-id'` (endpoint → api/client) — which
    // the catch below reported as exit 1, breaking the DF-9ROUTER-64 promise
    // ("a non-TTY menu resolves to exit and the launcher exits 0") on exactly
    // the clean box that guard was written for (DF-9ROUTER-70).
    if (!process.stdin.isTTY) {
      isShuttingDown = true;
      console.log("\nExiting...");
      cleanup();
      setTimeout(() => process.exit(0), 100);
      return;
    }

    // Resolve the parallel update check (already running); don't block server start on it.
    const updateOffer = await updateOfferPromise;
    // Start tray icon alongside TUI
    initTrayIcon();

    try {
      while (true) {
        const choice = await showInterfaceMenu(updateOffer);

        if (choice === "update") {
          isShuttingDown = true;
          const { clearScreen } = require("./src/cli/utils/display");
          clearScreen();
          if (updateOffer.kind === "upstream-replaces-fork") {
            console.log(`\n⬆  Install upstream v${updateOffer.latestVersion} (removes federation)\n`);
            console.log("This replaces this federation fork with upstream 9router.\n");
          } else {
            console.log(`\n⬆  Update v${pkg.version} → v${updateOffer.latestVersion}\n`);
          }
          console.log("Run this after exit:\n");
          console.log(`   \x1b[33m${updateOffer.installCommand}\x1b[0m\n`);
          cleanup();
          await killAllAppProcesses(port);
          await killProcessOnPort(port);
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

          // Enable auto startup on OS boot
          try {
            const { enableAutoStart } = require("./src/cli/tray/autostart");
            enableAutoStart(__filename);
          } catch (e) { }

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

          // Windows/Linux: spawn detached bgProcess (systray works fine in child)
          console.log(`\n⏳ Starting background process... (tray icon will appear in ~3s)`);

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

          // cleanup() kills server so bgProcess can claim the port fresh
          cleanup();
          process.exit(0);
        } else if (choice === "exit") {
          isShuttingDown = true;
          console.log("\nExiting...");
          cleanup();
          setTimeout(() => process.exit(0), 100);
          // Stop the menu loop: without this the loop re-renders and prints a
          // fresh "Exiting..." on every 100ms tick until the timer fires (the
          // exit is scheduled, not immediate).
          return;
        }
      }
    } catch (err) {
      console.error("Error:", err.message);
      cleanup();
      process.exit(1);
    }
  });

  function attachServerEvents() {
    server.on("error", (err) => {
      console.error("Failed to start server:", err.message);
      // Before readiness the startup gate owns the failure: it reports the
      // diagnostic and exits non-zero (DF-9ROUTER-18). Restarting here would
      // race it and could mask a start that never works.
      if (!serverReady) return;
      if (!isShuttingDown) tryRestart();
      else { cleanup(); process.exit(1); }
    });

    server.on("close", (code) => {
      if (!serverReady) return; // pre-ready exits are reported by the startup gate
      if (isShuttingDown || code === 0) {
        logExit("server-exit", { code: code ?? null, shuttingDown: isShuttingDown }); // loud (DF-9ROUTER-64)
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
      console.error(`\n⚠️  Server crashed ${MAX_RESTARTS} times. Disabling MIT and restarting...`);
      try {
        const dbPath = path.join(os.homedir(), process.platform === "win32" ? path.join("AppData", "Roaming", "9router", "db.json") : path.join(".9router", "db.json"));
        if (fs.existsSync(dbPath)) {
          const db = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
          if (db.settings) db.settings.mitmEnabled = false;
          fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
        }
      } catch { /* best effort */ }
      restartCount = 0;
      server = spawnServer();
      attachServerEvents();
      return;
    }

    restartCount++;
    const delay = Math.min(1000 * restartCount, 10000);
    console.error(`\n⚠️  Server exited (code=${code ?? "unknown"}). Restarting in ${delay / 1000}s... (${restartCount}/${MAX_RESTARTS})`);
    printCrashLog();

    setTimeout(() => {
      server = spawnServer();
      attachServerEvents();
    }, delay);
  }

  attachServerEvents();
}
