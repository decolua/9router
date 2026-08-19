#!/usr/bin/env node

const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
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

// Provider-scoped auth hook used by modern Codex. Stdout must contain only the
// bearer token because Codex consumes it directly.
if (args[0] === "codex" && args[1] === "auth-token") {
  const { run } = require("./src/cli/commands/codexAuthToken");
  run(args.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err?.message || String(err));
      process.exit(1);
    });
  return;
}

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

// Self-heal SQLite runtime deps (sql.js + better-sqlite3) into ~/.9router/runtime
// so the server can resolve them via NODE_PATH. Best-effort — sql.js is required,
// better-sqlite3 is optional. Logs to stderr only on failure.
try { ensureSqliteRuntime({ silent: true }); } catch {}

// Self-heal tray runtime (systray for macOS/Linux only). Windows skipped.
try { ensureTrayRuntime({ silent: true }); } catch {}

// Configuration constants
const APP_NAME = pkg.name; // Use from package.json
const INSTALL_CMD_LATEST = `npm i -g ${APP_NAME}@latest --prefer-online`;

const DEFAULT_PORT = 20128;
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
// Parse arguments
let port = DEFAULT_PORT;
let host = DEFAULT_HOST;
let noBrowser = false;
let skipUpdate = false;
let showLog = false;
let trayMode = false;
let takeOver = false;

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
    process.env.TRAY_MODE = "1";
  } else if (args[i] === "--takeover") {
    // Internal hand-off flag used when the interactive launcher moves itself
    // into the tray. It waits for its parent-owned server to release the port
    // instead of killing a process based on a broad system scan.
    takeOver = true;
  } else if (args[i] === "--help" || args[i] === "-h") {
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
  codex auth-token     Print the provider-scoped Codex bridge token
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

// Auto-relaunch after update: detached process has no TTY → fallback to tray
if (skipUpdate && !trayMode && !process.stdin.isTTY) {
  trayMode = true;
  process.env.TRAY_MODE = "1";
}

// Always use Node.js runtime with absolute path
const RUNTIME = process.execPath;

// Compare semver versions: returns 1 if a > b, -1 if a < b, 0 if equal
function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

// Get app data dir (matches app/src/lib/dataDir.js convention)
function getAppDataDir() {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || "", "9router")
    : path.join(os.homedir(), ".9router");
}

function taskkill(pid, { force = false, tree = true, timeout = 3000 } = {}) {
  const args = [];
  if (force) args.push("/F");
  if (tree) args.push("/T");
  args.push("/PID", String(pid));
  return spawnSync("taskkill.exe", args, {
    windowsHide: true,
    stdio: "ignore",
    timeout,
  });
}

function readPidFile(pidFile) {
  try {
    const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function removePidFile(pidFile) {
  try { fs.unlinkSync(pidFile); } catch { /* best effort */ }
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// A PID file alone is not ownership proof: Windows can recycle a PID between
// launches.  MITM exposes a local health endpoint that includes its live PID,
// so only that response authorizes this launcher to stop the process.
function verifyMitmPid(pid) {
  return new Promise((resolve) => {
    let body = "";
    const request = https.get({
      hostname: "127.0.0.1",
      port: 443,
      path: "/_mitm_health",
      rejectUnauthorized: false,
      timeout: 1000,
      agent: false,
    }, (response) => {
      response.on("data", (chunk) => { body = `${body}${chunk}`.slice(0, 4096); });
      response.on("end", () => {
        try {
          resolve(response.statusCode === 200 && JSON.parse(body).pid === pid ? "owned" : "different");
        } catch {
          resolve("different");
        }
      });
    });
    request.once("error", () => resolve("unreachable"));
    request.once("timeout", () => { request.destroy(); resolve("unreachable"); });
  });
}

async function stopVerifiedMitmByPidFile() {
  const pidFile = path.join(getAppDataDir(), "mitm", ".mitm.pid");
  const pid = readPidFile(pidFile);
  if (!pid) return false;
  if (!isPidAlive(pid)) {
    removePidFile(pidFile);
    return false;
  }

  const ownership = await verifyMitmPid(pid);
  if (ownership === "different") {
    // The process either ended or is no longer this 9router MITM instance.
    // Retire only the stale marker; never terminate an unverified PID.
    removePidFile(pidFile);
    return false;
  }
  if (ownership !== "owned") {
    // Keep an ambiguous marker for the owning server to reconcile later.
    console.warn(`[9router] Refusing to stop unverified MITM PID ${pid}.`);
    return false;
  }

  try {
    if (process.platform === "win32") {
      const result = taskkill(pid, { timeout: 3000 });
      if (result.status !== 0) return false;
    } else {
      process.kill(pid, "SIGTERM");
    }
    removePidFile(pidFile);
    return true;
  } catch {
    return false;
  }
}

// Probe the router itself rather than killing whatever happens to own a port.
// This avoids terminating unrelated local apps and avoids cmd/PowerShell at
// every launcher start.
function probeExistingRouter(port) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (status) => {
      if (settled) return;
      settled = true;
      resolve(status);
    };
    const request = http.get({
      host: "127.0.0.1",
      port,
      path: "/api/health",
      timeout: 800,
      agent: false,
    }, (response) => {
      response.resume();
      done(response.statusCode === 200 ? "router" : "occupied");
    });
    request.once("error", (error) => {
      done(error?.code === "ECONNREFUSED" ? "free" : "occupied");
    });
    request.once("timeout", () => {
      request.destroy();
      done("occupied");
    });
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForPortRelease(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let status = "occupied";
  do {
    status = await probeExistingRouter(port);
    if (status === "free") return status;
    await delay(150);
  } while (Date.now() < deadline);
  return status;
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
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "explorer.exe"
      : "xdg-open";
  try {
    const child = spawn(command, [url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => console.log(`Open browser manually: ${url}`));
    child.unref();
  } catch {
    console.log(`Open browser manually: ${url}`);
  }
}

// The hand-off launcher is the one intentionally detached child in this file.
// Do not tear down the foreground server until Windows has confirmed that the
// background launcher was actually created; otherwise an async ENOENT/error
// leaves the user with neither a tray process nor a running server.
function spawnBackgroundTray(port) {
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    try {
      child = spawn(process.execPath, [
        "--dns-result-order=ipv4first",
        __filename,
        "--tray",
        "--skip-update",
        "--takeover",
        "-p",
        port.toString(),
      ], {
        // This one deliberate hand-off needs to outlive the interactive
        // terminal. The server itself remains non-detached; windowsHide keeps
        // this launcher from creating a visible console window.
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env },
      });
    } catch (error) {
      reject(error);
      return;
    }

    const onError = (error) => finish(reject, error);
    child.once("error", onError);
    child.once("spawn", () => {
      child.removeListener("error", onError);
      child.unref();
      finish(resolve, child);
    });
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
const updatePromise = checkForUpdate();
void (async () => {
  const existing = takeOver
    ? await waitForPortRelease(port)
    : await probeExistingRouter(port);
  const displayHost = getDisplayHost();
  const url = `http://${displayHost}:${port}/dashboard`;

  if (existing === "router") {
    // One DATA_DIR/port gets one launcher. Starting a second copy used to kill
    // the first copy through broad PowerShell process scans, which orphaned
    // tray children and corrupted concurrent DB writers.
    if (!trayMode && !noBrowser) openBrowser(url);
    console.log(`9Router is already running at ${url}`);
    return;
  }

  if (existing === "occupied") {
    console.error(`Port ${port} is already in use by another application. 9Router did not terminate it.`);
    process.exitCode = 1;
    return;
  }

  startServer(updatePromise);
})();

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

const MAX_RESTARTS_PER_WINDOW = 2;
const RESTART_WINDOW_MS = 5 * 60 * 1000;

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

  let restartTimestamps = [];
  let restartTimer = null;

  const CRASH_LOG_LINES = 50;
  let crashLog = [];

  function spawnServer() {
    crashLog = [];
    const child = spawn(RUNTIME, ["--dns-result-order=ipv4first", "--max-old-space-size=6144", serverPath], {
      cwd: standaloneDir,
      stdio: showLog ? "inherit" : ["ignore", "ignore", "pipe"],
      // The launcher owns this child. A detached Windows child creates its
      // own console/process group and survived failed restart cycles.
      detached: false,
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

  // The launcher only owns this direct child. Tunnel and Tailscale PID files
  // are written by separate service managers, so treating their bare PIDs as
  // ours can kill a recycled, unrelated Windows process. The server receives
  // a bounded graceful shutdown and cleans up the tunnel it spawned itself.
  let isCleaningUp = false;
  let cleanupPromise = null;

  function stopOwnedServer(child) {
    return new Promise((resolve) => {
      if (!child?.pid || (child.exitCode !== null && child.exitCode !== undefined)) {
        resolve();
        return;
      }

      let finished = false;
      let forceTimer = null;
      let finalTimer = null;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (forceTimer) clearTimeout(forceTimer);
        if (finalTimer) clearTimeout(finalTimer);
        resolve();
      };

      child.once("close", finish);
      child.once("error", finish);
      try {
        child.kill("SIGTERM");
      } catch {
        finish();
        return;
      }

      // Do not use child.killed here: Node marks it immediately after a kill
      // request on Windows, before the OS process has actually exited.
      forceTimer = setTimeout(() => {
        if (child.exitCode === null || child.exitCode === undefined) {
          try { child.kill("SIGKILL"); } catch { /* already exited */ }
        }
        finalTimer = setTimeout(finish, 250);
      }, 2000);
    });
  }

  function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    isCleaningUp = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }

    const shutdowns = [stopOwnedServer(server), stopVerifiedMitmByPidFile()];
    try {
      const { killTray } = require("./src/cli/tray/tray");
      shutdowns.push(Promise.resolve(killTray()));
    } catch { /* tray is optional */ }

    cleanupPromise = Promise.allSettled(shutdowns).then(() => undefined);
    return cleanupPromise;
  }

  function exitAfterCleanup(code) {
    // Every cleanup operation is bounded (server: 2.25s, MITM health: 1s,
    // Windows tray: 750ms). Awaiting it prevents a tray hand-off from racing
    // a still-running foreground server, but cannot hang the terminal.
    void cleanup().finally(() => process.exit(code));
  }

  // A launcher exception cannot safely continue with a half-owned child tree.
  // Exit once after cleanup instead of swallowing it and leaking server/tray
  // processes into the next launch.
  let isShuttingDown = false;
  const handleFatal = (err) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.error("Fatal launcher error:", err?.stack || err?.message || err);
    exitAfterCleanup(1);
  };
  process.on("uncaughtException", handleFatal);
  process.on("unhandledRejection", handleFatal);

  // Handle all exit scenarios
  process.on("SIGINT", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log("\nExiting...");
    exitAfterCleanup(0);
  });
  process.on("SIGTERM", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    exitAfterCleanup(0);
  });
  process.on("SIGHUP", () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    exitAfterCleanup(0);
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
    if (!process.stdin.isTTY) {
      if (!noBrowser) openBrowser(url);
      console.log(`\n🚀 9Router v${pkg.version} running at http://${displayHost}:${port}`);
      return;
    }
    initTrayIcon();

    try {
      while (true) {
        const choice = await showInterfaceMenu(latestVersion);

        if (choice === "update") {
          isShuttingDown = true;
          const { clearScreen } = require("./src/cli/utils/display");
          clearScreen();
          console.log(`\n⬆  Update v${pkg.version} → v${latestVersion}\n`);
          console.log(`Run this after exit:\n`);
          console.log(`   \x1b[33m${INSTALL_CMD_LATEST}\x1b[0m\n`);
          cleanup();
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

          let bgProcess;
          try {
            bgProcess = await spawnBackgroundTray(port);
          } catch (error) {
            // Keep the foreground router alive if Windows cannot create the
            // replacement launcher. Losing the tray is recoverable; losing
            // the active router is not.
            console.error(`Could not start background process: ${error.message}`);
            continue;
          }

          console.log(`🔔 9Router is now running in background (PID: ${bgProcess.pid})`);
          console.log(`   Server: http://${displayHost}:${port}`);
          console.log(`\n💡 You can close this terminal. Right-click tray icon to quit.\n`);

          // cleanup() kills server so bgProcess can claim the port fresh.
          // `spawnBackgroundTray` already confirmed creation, so no async
          // ENOENT race can leave the user without a running router.
          isShuttingDown = true;
          void cleanup();
          process.exit(0);
        } else if (choice === "exit") {
          isShuttingDown = true;
          console.log("\nExiting...");
          cleanup();
          setTimeout(() => process.exit(0), 100);
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
      if (!isShuttingDown) tryRestart();
      else { cleanup(); process.exit(1); }
    });

    server.on("close", (code) => {
      if (isShuttingDown || code === 0) {
        process.exit(code || 0);
        return;
      }
      tryRestart(code);
    });
  }

  function tryRestart(code) {
    if (isShuttingDown || restartTimer) return;

    const now = Date.now();
    restartTimestamps = restartTimestamps.filter((timestamp) => now - timestamp < RESTART_WINDOW_MS);
    if (restartTimestamps.length >= MAX_RESTARTS_PER_WINDOW) {
      console.error("\nServer crashed too many times in five minutes; stopping to prevent a restart loop.");
      if (crashLog.length) {
        console.error("\n--- Server crash log ---");
        crashLog.forEach(line => console.error(line));
        console.error("--- End crash log ---\n");
      }
      isShuttingDown = true;
      cleanup();
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 100);
      return;
    }

    restartTimestamps.push(now);
    const restartCount = restartTimestamps.length;
    const delay = Math.min(1000 * restartCount, 10000);
    console.error(`\nServer exited (code=${code ?? "unknown"}). Restarting in ${delay / 1000}s... (${restartCount}/${MAX_RESTARTS_PER_WINDOW})`);
    if (crashLog.length) {
      console.error("\n--- Server crash log ---");
      crashLog.forEach(l => console.error(l));
      console.error("--- End crash log ---\n");
    }

    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (isShuttingDown) return;
      server = spawnServer();
      attachServerEvents();
    }, delay);
  }

  attachServerEvents();
}
