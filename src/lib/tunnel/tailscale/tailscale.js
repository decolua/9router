import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile, execFileSync, spawn } from "child_process";
import { promisify } from "util";
import { execWithPassword } from "@/mitm/dns/dnsConfig";
import { DATA_DIR } from "@/lib/dataDir.js";

const execFileAsync = promisify(execFile);

const BIN_DIR = path.join(DATA_DIR, "bin");
const IS_MAC = os.platform() === "darwin";
const IS_LINUX = os.platform() === "linux";
const IS_WINDOWS = os.platform() === "win32";
const TAILSCALE_BIN = path.join(BIN_DIR, IS_WINDOWS ? "tailscale.exe" : "tailscale");

// Custom socket for userspace-networking mode (no root required)
const TAILSCALE_DIR = path.join(DATA_DIR, "tailscale");
export const TAILSCALE_SOCKET = path.join(TAILSCALE_DIR, "tailscaled.sock");
const SOCKET_FLAG = IS_WINDOWS ? [] : ["--socket", TAILSCALE_SOCKET];

// System daemon socket (sudo install: apt/snap/systemd) — read-only status detection
const SYSTEM_TAILSCALE_SOCKET = IS_WINDOWS ? null : "/var/run/tailscale/tailscaled.sock";
const SYSTEM_SOCKET_FLAG = SYSTEM_TAILSCALE_SOCKET ? ["--socket", SYSTEM_TAILSCALE_SOCKET] : [];

// Well-known Windows install path
const WINDOWS_TAILSCALE_BIN = "C:\\Program Files\\Tailscale\\tailscale.exe";

// Common Unix install paths to probe synchronously (system tailscale)
const UNIX_TAILSCALE_CANDIDATES = [
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/sbin/tailscale",   // apt package on Debian/Ubuntu
  "/usr/bin/tailscale",
  "/snap/bin/tailscale",   // Snap package
];

const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/sbin:/usr/bin:/bin:/snap/bin:${process.env.PATH || ""}`;

// ─── Cache + background refresh (avoid blocking event loop on dead daemon) ──
const PROBE_TTL_MS = 10000;
const PROBE_TIMEOUT_MS = 1500;

const binCache = { value: undefined, fetchedAt: 0, refreshing: false };
const runningCache = { value: false, fetchedAt: 0, refreshPromise: null };
const loggedInCache = { value: false, fetchedAt: 0, refreshing: false };
const funnelUrlCache = { value: null, port: null, fetchedAt: 0, refreshing: false };

// `exec()` always starts a shell (`cmd.exe` on Windows). Keep all Tailscale
// calls on the direct execFile/spawn path so dashboard polling never creates
// a console host. These helpers also give every probe the same safe defaults.
function executableOptions(options = {}) {
  const { env, ...rest } = options;
  return {
    windowsHide: true,
    env: { ...process.env, PATH: EXTENDED_PATH, ...(env || {}) },
    ...rest,
  };
}

function runExecutable(bin, args, options = {}) {
  return execFileAsync(bin, args, executableOptions(options));
}

function runExecutableSync(bin, args, options = {}) {
  return execFileSync(bin, args, executableOptions(options));
}

function runTailscale(bin, args, options = {}) {
  return runExecutable(bin, args, options);
}

function runTailscaleSync(bin, args, options = {}) {
  return runExecutableSync(bin, args, options);
}

function socketCandidates() {
  const seen = new Set();
  return [SOCKET_FLAG, SYSTEM_SOCKET_FLAG].filter((args) => {
    const key = args.join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isBackendRunning(status) {
  return !!status?.BackendState && status.BackendState !== "NoState";
}

function isBackendLoggedIn(status) {
  return status?.BackendState === "Running" && status.Self?.Online === true;
}

const statusCache = {
  value: null,
  fetchedAt: 0,
  refreshPromise: null,
};

function invalidateStatusCache() {
  statusCache.fetchedAt = 0;
}

/**
 * Read `tailscale status --json` once for all concurrent callers. This is
 * intentionally shared by the dashboard, route probe, login poll, and
 * watchdog so a slow daemon cannot turn polling into a process storm.
 */
export async function getTailscaleBackendStatus({ force = false, timeout = PROBE_TIMEOUT_MS } = {}) {
  if (!force && Date.now() - statusCache.fetchedAt < PROBE_TTL_MS) {
    return statusCache.value;
  }
  if (statusCache.refreshPromise) return statusCache.refreshPromise;

  const bin = getTailscaleBin();
  if (!bin) {
    statusCache.value = null;
    statusCache.fetchedAt = Date.now();
    loggedInCache.value = false;
    loggedInCache.fetchedAt = statusCache.fetchedAt;
    return null;
  }

  const refresh = (async () => {
    for (const socketArgs of socketCandidates()) {
      try {
        const { stdout } = await runTailscale(bin, [...socketArgs, "status", "--json"], { timeout });
        const status = JSON.parse(stdout);
        statusCache.value = status;
        statusCache.fetchedAt = Date.now();
        loggedInCache.value = isBackendLoggedIn(status);
        loggedInCache.fetchedAt = statusCache.fetchedAt;
        return status;
      } catch {
        // A custom socket can be absent while the system daemon is healthy.
      }
    }
    statusCache.value = null;
    statusCache.fetchedAt = Date.now();
    loggedInCache.value = false;
    loggedInCache.fetchedAt = statusCache.fetchedAt;
    return null;
  })();

  statusCache.refreshPromise = refresh;
  try {
    return await refresh;
  } finally {
    if (statusCache.refreshPromise === refresh) statusCache.refreshPromise = null;
  }
}

function fallbackBin() {
  if (fs.existsSync(TAILSCALE_BIN)) return TAILSCALE_BIN;
  if (IS_WINDOWS && fs.existsSync(WINDOWS_TAILSCALE_BIN)) return WINDOWS_TAILSCALE_BIN;
  if (!IS_WINDOWS) return UNIX_TAILSCALE_CANDIDATES.find((p) => fs.existsSync(p)) || null;
  return null;
}

function bgRefreshBin() {
  if (binCache.refreshing) return;
  binCache.refreshing = true;
  const command = IS_WINDOWS ? "where.exe" : "which";
  runExecutable(command, ["tailscale"], { timeout: PROBE_TIMEOUT_MS })
    .then(({ stdout }) => {
      const sys = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
      const nextBin = sys || fallbackBin();
      if (nextBin !== binCache.value) invalidateStatusCache();
      binCache.value = nextBin;
    })
    .catch(() => {
      const nextBin = fallbackBin();
      if (nextBin !== binCache.value) invalidateStatusCache();
      binCache.value = nextBin;
    })
    .finally(() => {
      binCache.fetchedAt = Date.now();
      binCache.refreshing = false;
    });
}

// Sync getter: returns cached value, triggers background refresh if stale
export function getTailscaleBin() {
  // First call: synchronously probe common install paths (no exec, no event-loop block)
  if (binCache.value === undefined) {
    if (fs.existsSync(TAILSCALE_BIN)) binCache.value = TAILSCALE_BIN;
    else if (IS_WINDOWS && fs.existsSync(WINDOWS_TAILSCALE_BIN)) binCache.value = WINDOWS_TAILSCALE_BIN;
    else if (!IS_WINDOWS) {
      const found = UNIX_TAILSCALE_CANDIDATES.find((p) => fs.existsSync(p));
      binCache.value = found || null;
    } else binCache.value = null;
    // A known standard install path needs no `where.exe` probe at all.
    if (binCache.value) binCache.fetchedAt = Date.now();
  }
  if (Date.now() - binCache.fetchedAt > PROBE_TTL_MS) bgRefreshBin();
  return binCache.value;
}

export function isTailscaleInstalled() {
  return getTailscaleBin() !== null;
}

/** Build tailscale CLI args with custom socket (no root needed) */
function tsArgs(...args) {
  return [...SOCKET_FLAG, ...args];
}

// Async strict probe: authoritative, awaitable (never blocks event loop). Updates cache.
export async function isTailscaleLoggedInStrict() {
  const status = await getTailscaleBackendStatus({ force: true, timeout: 5000 });
  const loggedIn = isBackendLoggedIn(status);
  loggedInCache.value = loggedIn;
  loggedInCache.fetchedAt = Date.now();
  return loggedIn;
}

function bgRefreshLoggedIn() {
  if (loggedInCache.refreshing) return;
  loggedInCache.refreshing = true;
  // Dual-socket aware: probe custom socket first, then system socket.
  // The backend status cache is single-flight across all callers.
  getTailscaleBackendStatus()
    .then((json) => {
      loggedInCache.value = isBackendLoggedIn(json);
    })
    .catch(() => { loggedInCache.value = false; })
    .finally(() => {
      loggedInCache.fetchedAt = Date.now();
      loggedInCache.refreshing = false;
    });
}

// Sync getter: never blocks; returns last known state, refreshes in background
export function isTailscaleLoggedIn() {
  if (Date.now() - loggedInCache.fetchedAt > PROBE_TTL_MS) bgRefreshLoggedIn();
  return loggedInCache.value;
}

async function refreshRunning({ force = false, timeout = PROBE_TIMEOUT_MS } = {}) {
  if (!force && Date.now() - runningCache.fetchedAt < PROBE_TTL_MS) return runningCache.value;
  if (runningCache.refreshPromise) return runningCache.refreshPromise;

  const bin = getTailscaleBin();
  if (!bin) {
    runningCache.value = false;
    runningCache.fetchedAt = Date.now();
    return false;
  }

  const refresh = runTailscale(bin, [...SOCKET_FLAG, "funnel", "status", "--json"], { timeout })
    .then(({ stdout }) => {
      try {
        const json = JSON.parse(stdout);
        runningCache.value = Object.keys(json.AllowFunnel || {}).length > 0;
      } catch {
        runningCache.value = false;
      }
      return runningCache.value;
    })
    .catch(() => {
      runningCache.value = false;
      return false;
    })
    .finally(() => {
      runningCache.fetchedAt = Date.now();
      if (runningCache.refreshPromise === refresh) runningCache.refreshPromise = null;
    });
  runningCache.refreshPromise = refresh;
  return refresh;
}

function bgRefreshRunning() {
  void refreshRunning();
}

// Sync getter: never blocks; returns last known state, refreshes in background
export function isTailscaleRunning() {
  if (Date.now() - runningCache.fetchedAt > PROBE_TTL_MS) bgRefreshRunning();
  return runningCache.value;
}

// Async strict probe for hot user-initiated paths (enable/connect flow).
// Awaitable, never blocks event loop; updates cache as a side effect.
export async function isTailscaleRunningStrict() {
  return refreshRunning({ force: true });
}

// Check if a system-level tailscaled is running (uses system socket, not 9Router's custom one).
export function isSystemDaemonRunning() {
  if (IS_WINDOWS || !SYSTEM_TAILSCALE_SOCKET || !fs.existsSync(SYSTEM_TAILSCALE_SOCKET)) return false;
  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    const out = runTailscaleSync(bin, [...SYSTEM_SOCKET_FLAG, "status", "--json"], {
      encoding: "utf8", timeout: PROBE_TIMEOUT_MS,
    });
    return JSON.parse(out).BackendState === "Running";
  } catch {
    return false;
  }
}

function bgRefreshFunnelUrl(port) {
  if (funnelUrlCache.refreshing) return;
  funnelUrlCache.refreshing = true;
  getTailscaleBackendStatus()
    .then((json) => {
      const dnsName = json?.Self?.DNSName?.replace(/\.$/, "");
      funnelUrlCache.value = dnsName ? `https://${dnsName}` : null;
    })
    .catch(() => { /* keep prev */ })
    .finally(() => {
      funnelUrlCache.port = port;
      funnelUrlCache.fetchedAt = Date.now();
      funnelUrlCache.refreshing = false;
    });
}

/** Get actual funnel URL from Self.DNSName (sync, authoritative — avoids hostname-conflict suffix). */
async function getActualFunnelUrl({ force = false } = {}) {
  const json = await getTailscaleBackendStatus({ force, timeout: 5000 });
  const dnsName = json?.Self?.DNSName?.replace(/\.$/, "");
  return dnsName ? `https://${dnsName}` : null;
}

/** Get funnel URL from tailscale status (cached, non-blocking) */
export function getTailscaleFunnelUrl(port) {
  if (Date.now() - funnelUrlCache.fetchedAt > PROBE_TTL_MS || funnelUrlCache.port !== port) {
    bgRefreshFunnelUrl(port);
  }
  return funnelUrlCache.value;
}

/**
 * Install tailscale.
 * - macOS + brew: brew install tailscale (no sudo needed)
 * - macOS no brew: download .pkg then sudo installer -pkg
 * - Linux: fetch install.sh, pipe to sudo -S sh via stdin
 * - Windows: download MSI via UAC-elevated PowerShell
 */
export async function installTailscale(sudoPassword, hostname, onProgress) {
  const log = onProgress || (() => {});
  if (IS_WINDOWS) {
    await installTailscaleWindows(log);
    return { success: true };
  }
  if (IS_MAC) await installTailscaleMac(sudoPassword, log);
  else await installTailscaleLinux(sudoPassword, log);

  log("Starting daemon...");
  await startDaemonWithPassword(sudoPassword);
  log("Logging in...");
  return startLogin(hostname);
}

function hasBrew() {
  try { runExecutableSync("which", ["brew"], { stdio: "ignore" }); return true; } catch { return false; }
}

async function installTailscaleMac(sudoPassword, log) {
  if (hasBrew()) {
    log("Installing via Homebrew...");
    await new Promise((resolve, reject) => {
      const child = spawn("brew", ["install", "tailscale"], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH }
      });
      child.stdout.on("data", (d) => {
        const line = d.toString().trim();
        if (line) log(line);
      });
      child.stderr.on("data", (d) => {
        const line = d.toString().trim();
        if (line) log(line);
      });
      child.on("close", (c) => {
        if (c === 0) resolve();
        else reject(new Error(`brew install failed (code ${c})`));
      });
      child.on("error", reject);
    });
    return;
  }

  // No brew: download .pkg and install via sudo installer
  const pkgUrl = "https://pkgs.tailscale.com/stable/tailscale-latest.pkg";
  const pkgPath = path.join(os.tmpdir(), "tailscale.pkg");

  log("Downloading Tailscale package...");
  await new Promise((resolve, reject) => {
    const child = spawn("curl", ["-fL", "--progress-bar", pkgUrl, "-o", pkgPath], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    child.stderr.on("data", (d) => {
      const line = d.toString().trim();
      if (line) log(line);
    });
    child.on("close", (c) => {
      if (c === 0) resolve();
      else reject(new Error("Download failed"));
    });
    child.on("error", reject);
  });

  log("Installing package...");
  await new Promise((resolve, reject) => {
    const child = spawn("sudo", ["-S", "installer", "-pkg", pkgPath, "-target", "/"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.stdout.on("data", (d) => {
      const line = d.toString().trim();
      if (line) log(line);
    });
    child.on("close", (c) => {
      try { fs.unlinkSync(pkgPath); } catch { /* ignore */ }
      if (c === 0) resolve();
      else {
        const msg = (stderr.includes("incorrect password") || stderr.includes("Sorry"))
          ? "Wrong sudo password"
          : stderr || `Exit code ${c}`;
        reject(new Error(msg));
      }
    });
    child.on("error", reject);
    child.stdin.write(`${sudoPassword}\n`);
    child.stdin.end();
  });
}

async function installTailscaleLinux(sudoPassword, log) {
  // Reject password containing newline → prevents stdin command injection
  if (typeof sudoPassword !== "string" || sudoPassword.includes("\n")) {
    throw new Error("Invalid sudo password");
  }
  log("Downloading install script...");
  return new Promise((resolve, reject) => {
    const curlChild = spawn("curl", ["-fsSL", "https://tailscale.com/install.sh"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let scriptContent = "";
    let curlErr = "";
    curlChild.stdout.on("data", (d) => { scriptContent += d.toString(); });
    curlChild.stderr.on("data", (d) => { curlErr += d.toString(); });
    curlChild.on("exit", (code) => {
      if (code !== 0) return reject(new Error(`Failed to download install script: ${curlErr}`));
      log("Running install script...");
      // Persist script to temp file → exec by path (NOT via stdin) → sh never reads attacker-controlled stdin
      const tmpScript = path.join(os.tmpdir(), `tailscale-install-${crypto.randomBytes(8).toString("hex")}.sh`);
      try {
        fs.writeFileSync(tmpScript, scriptContent, { mode: 0o700 });
      } catch (e) {
        return reject(new Error(`Failed to write install script: ${e.message}`));
      }
      const cleanup = () => { try { fs.unlinkSync(tmpScript); } catch {} };
      const child = spawn("sudo", ["-S", "sh", tmpScript], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let stderr = "";
      child.stdout.on("data", (d) => {
        const line = d.toString().trim();
        if (line) log(line);
      });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("close", (c) => {
        cleanup();
        if (c === 0) resolve();
        else {
          const msg = (stderr.includes("incorrect password") || stderr.includes("Sorry"))
            ? "Wrong sudo password"
            : stderr || `Exit code ${c}`;
          reject(new Error(msg));
        }
      });
      child.on("error", (e) => { cleanup(); reject(e); });
      child.stdin.write(`${sudoPassword}\n`);
      child.stdin.end();
    });
    curlChild.on("error", reject);
  });
}

async function installTailscaleWindows(log) {
  const msiUrl = "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi";
  const msiPath = path.join(os.tmpdir(), "tailscale-setup.msi");

  // Download MSI via curl.exe (built-in on Win10+) — no PowerShell window, streams progress
  log("Downloading Tailscale installer...");
  await new Promise((resolve, reject) => {
    const child = spawn("curl.exe", ["-L", "-#", "-o", msiPath, msiUrl], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    // curl outputs progress to stderr with -# flag
    let lastPct = "";
    child.stderr.on("data", (d) => {
      const text = d.toString();
      const match = text.match(/(\d+\.\d)%/);
      if (match && match[1] !== lastPct) {
        lastPct = match[1];
        log(`Downloading... ${lastPct}%`);
      }
    });
    child.on("close", (c) => c === 0 ? resolve() : reject(new Error("Download failed")));
    child.on("error", reject);
  });

  // Install MSI with UAC elevation via PowerShell Start-Process -Verb RunAs
  log("Installing Tailscale (UAC prompt may appear)...");
  await new Promise((resolve, reject) => {
    const args = `'/i','${msiPath}','TS_NOLAUNCH=true','/quiet','/norestart'`;
    const child = spawn("powershell", [
      "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
      `Start-Process msiexec -WindowStyle Hidden -ArgumentList ${args} -Verb RunAs -Wait`
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    child.stderr.on("data", (d) => { const l = d.toString().trim(); if (l) log(l); });
    child.on("close", (c) => {
      try { fs.unlinkSync(msiPath); } catch { /* ignore */ }
      c === 0 ? resolve() : reject(new Error(`msiexec failed (code ${c})`));
    });
    child.on("error", reject);
  });

  // Verify tailscale.exe exists after install
  log("Verifying installation...");
  const maxWait = 10000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    if (fs.existsSync(WINDOWS_TAILSCALE_BIN)) {
      log("Installation complete.");
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Installation finished but tailscale.exe not found");
}

// Self-heal: if state dir/files were previously created by root (e.g. legacy sudo daemon),
// reclaim ownership recursively so the user-mode daemon can read/write state files.
async function ensureUserOwnedDir(dir) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      return;
    }
    const uid = process.getuid();
    const gid = process.getgid();

    // Walk dir + all entries to find any non-user-owned items
    const needsChown = (() => {
      const stack = [dir];
      while (stack.length) {
        const cur = stack.pop();
        try {
          const st = fs.statSync(cur);
          if (st.uid !== uid) return true;
          if (st.isDirectory()) {
            for (const name of fs.readdirSync(cur)) stack.push(path.join(cur, name));
          }
        } catch { /* ignore */ }
      }
      return false;
    })();

    if (!needsChown) return;

    // Try direct chown first (works if already owned). Fallback to passwordless sudo.
    try {
      runExecutableSync("chown", ["-R", `${uid}:${gid}`, dir], { stdio: "ignore", timeout: 3000 });
    } catch {
      try { runExecutableSync("sudo", ["-n", "chown", "-R", `${uid}:${gid}`, dir], { stdio: "ignore", timeout: 3000 }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/** Check if running daemon uses TUN mode (Funnel TLS requires TUN). */
function isDaemonTunMode() {
  if (IS_WINDOWS) {
    // `pgrep` would fall back through cmd.exe on Windows. Return the most
    // recent backend state and refresh it asynchronously instead.
    void getTailscaleBackendStatus();
    return isBackendRunning(statusCache.value) ? true : null;
  }
  try {
    const ps = runExecutableSync("pgrep", ["-a", "-f", `tailscaled.*${TAILSCALE_SOCKET}`], { encoding: "utf8", timeout: 2000 }).trim();
    if (!ps) return null;
    return !ps.includes("--tun=userspace-networking");
  } catch { return null; }
}

/** Daemon process alive (independent of funnel state) — mirrors cloudflared PID check semantic. */
export function isDaemonAlive() {
  return isDaemonTunMode() !== null;
}

/**
 * Start tailscaled.
 * - With sudoPassword: TUN mode (root) → Funnel TLS works
 * - Without: userspace-networking fallback (no sudo, but Funnel TLS unstable)
 * State always lives in ~/.9router/tailscale/ via --statedir.
 */
export async function startDaemonWithPassword(sudoPassword) {
  if (IS_WINDOWS) {
    // Windows: tailscale runs as a Windows Service. Start it then poll BackendState
    // until daemon finishes init (avoids "NoState" errors when calling funnel/up too early).
    const bin = getTailscaleBin();
    console.log("[Tailscale] win: net start Tailscale");
    invalidateStatusCache();
    try { await runExecutable("net.exe", ["start", "Tailscale"], { timeout: 10000 }); }
    catch { /* may need admin, or already running */ }
    if (!bin) return;
    // Poll for at most 10s for backend to leave NoState. One direct probe per
    // second is enough for service startup and avoids a burst of processes.
    const readyStartedAt = Date.now();
    const readyDeadline = readyStartedAt + 10000;
    while (Date.now() < readyDeadline) {
      const remaining = readyDeadline - Date.now();
      const status = await getTailscaleBackendStatus({
        force: true,
        timeout: Math.min(2000, Math.max(500, remaining)),
      });
      if (isBackendRunning(status)) {
        console.log(`[Tailscale] win: BackendState=${status.BackendState} after ${Date.now() - readyStartedAt}ms`);
        return;
      }
      const delay = Math.min(1000, Math.max(0, readyDeadline - Date.now()));
      if (delay) await new Promise((r) => setTimeout(r, delay));
    }
    console.log("[Tailscale] win: BackendState still NoState after poll");
    return;
  }

  const currentMode = isDaemonTunMode(); // true=TUN, false=userspace, null=not running
  // No password but a healthy TUN daemon already runs → keep TUN, never downgrade-kill it.
  const wantTun = sudoPassword ? true : currentMode === true;

  // Daemon already running in correct mode → reuse
  if (currentMode !== null && currentMode === wantTun) {
    try {
      const bin = getTailscaleBin() || "tailscale";
      runTailscaleSync(bin, [...SOCKET_FLAG, "status", "--json"], {
        stdio: "ignore", timeout: 3000
      });
      return;
    } catch { /* unresponsive, restart below */ }
  }

  // Mode mismatch or unresponsive → kill all daemons on our socket
  try { runExecutableSync("pkill", ["-9", "-f", `tailscaled.*${TAILSCALE_SOCKET}`], { stdio: "ignore", timeout: 3000 }); } catch { /* ignore */ }
  if (sudoPassword) {
    try { await execWithPassword(`pkill -9 -f "tailscaled.*${TAILSCALE_SOCKET}"`, sudoPassword); } catch { /* ignore */ }
  } else {
    try { runExecutableSync("sudo", ["-n", "pkill", "-9", "-f", `tailscaled.*${TAILSCALE_SOCKET}`], { stdio: "ignore", timeout: 3000 }); } catch { /* ignore */ }
  }
  await new Promise((r) => setTimeout(r, 1500));

  // Reclaim folder ownership (previous root daemon may have locked it)
  await ensureUserOwnedDir(TAILSCALE_DIR);

  const tailscaledBin = IS_MAC ? "/usr/local/bin/tailscaled" : "tailscaled";
  const daemonArgs = [
    `--socket=${TAILSCALE_SOCKET}`,
    `--statedir=${TAILSCALE_DIR}`,
  ];
  if (!wantTun) daemonArgs.push("--tun=userspace-networking");

  if (wantTun) {
    // TUN mode: spawn via sudo, password via stdin. Detached so it survives parent exit.
    const child = spawn("sudo", ["-S", tailscaledBin, ...daemonArgs], {
      detached: true,
      stdio: ["pipe", "ignore", "ignore"],
      cwd: os.tmpdir(),
      env: { ...process.env, PATH: EXTENDED_PATH },
    });
    child.stdin.write(`${sudoPassword}\n`);
    child.stdin.end();
    child.unref();
  } else {
    const child = spawn(tailscaledBin, daemonArgs, {
      detached: true,
      stdio: "ignore",
      cwd: os.tmpdir(),
      env: { ...process.env, PATH: EXTENDED_PATH },
    });
    child.unref();
  }

  // Wait for socket ready
  await new Promise((r) => setTimeout(r, 3000));
}

/** Best-effort: ensure daemon running (used for login flow) */
function ensureDaemon() {
  startDaemonWithPassword("").catch(() => {});
}

/**
 * Run `tailscale up` and capture the auth URL for browser login.
 * Resolves with { authUrl } or { alreadyLoggedIn: true }.
 * On Windows, AuthURL comes from `status --json` (not stdout) — must poll status.
 */
const LOGIN_TIMEOUT_MS = 15000;
const LOGIN_AUTH_SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const LOGIN_STATUS_POLL_MS = 1000;
const LOGIN_AUTH_STATUS_POLL_MS = 5000;
const MAX_LOGIN_OUTPUT_BYTES = 64 * 1024;
let activeLoginSession = null;
const forceKillTimers = new WeakMap();

function terminateManagedChild(child, reason) {
  if (!child || (child.exitCode !== null && child.exitCode !== undefined)) return;
  if (forceKillTimers.has(child)) return;
  console.warn(`[Tailscale] terminating managed process (${reason})`);
  try { child.kill("SIGTERM"); } catch { /* process already gone */ }

  // On Windows child.kill maps to TerminateProcess. The fallback is still
  // direct Node process control — never taskkill/cmd.exe.
  const forceKill = setTimeout(() => {
    if (child.exitCode === null || child.exitCode === undefined) {
      try { child.kill("SIGKILL"); } catch { /* process already gone */ }
    }
  }, 2000);
  forceKillTimers.set(child, forceKill);
  child.once?.("exit", () => {
    clearTimeout(forceKill);
    forceKillTimers.delete(child);
  });
  if (forceKill.unref) forceKill.unref();
}

/** Cancel an in-browser login and reap its still-owned `tailscale up` child. */
export function cancelTailscaleLogin(reason = "Tailscale login cancelled") {
  const session = activeLoginSession;
  if (!session?.cancel) return false;
  session.cancel(reason);
  return true;
}

export function startLogin(hostname) {
  if (activeLoginSession) {
    // A retry while browser OAuth is pending must reuse the one owned `up`
    // child, rather than starting another detached process.
    if (activeLoginSession.authUrl) return Promise.resolve({ authUrl: activeLoginSession.authUrl });
    return activeLoginSession.promise;
  }

  const bin = getTailscaleBin();
  if (!bin) return Promise.reject(new Error("Tailscale not installed"));
  if (isTailscaleLoggedIn()) return Promise.resolve({ alreadyLoggedIn: true });

  const session = {
    authUrl: null,
    child: null,
    promise: null,
    cancel: null,
  };
  activeLoginSession = session;

  const promise = new Promise((resolve, reject) => {
    // Ensure daemon is running (best-effort, no sudo). A concurrent caller
    // receives this same login promise rather than starting another `up`.
    ensureDaemon();

    let responseSettled = false;
    let closed = false;
    let child;
    let output = "";
    let timeout;
    let statusPollTimer;
    let statusPollInFlight = false;

    const parseAuthUrl = (text) => {
      const match = text.match(/https:\/\/login\.tailscale\.com\/a\/[a-zA-Z0-9]+/);
      return match ? match[0] : null;
    };

    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(statusPollTimer);
    };

    const resolveOnce = (result) => {
      if (responseSettled) return;
      responseSettled = true;
      resolve(result);
    };

    const rejectOnce = (error) => {
      if (responseSettled) return;
      responseSettled = true;
      reject(error);
    };

    const closeSession = ({ reason, error, terminate = false }) => {
      if (closed) return;
      closed = true;
      cleanup();
      if (terminate) terminateManagedChild(child, reason);
      if (error) rejectOnce(error);
      if (activeLoginSession === session) activeLoginSession = null;
    };

    const confirmLogin = () => {
      if (closed) return;
      resolveOnce({ alreadyLoggedIn: true });
      // `tailscale up` normally exits after success. Reap it if it has not,
      // so a completed login cannot leave a detached process behind.
      closeSession({ reason: "login confirmed", terminate: true });
    };

    const finishWithUrl = (url, source) => {
      if (!url || closed) return false;
      if (!session.authUrl) {
        session.authUrl = url;
        console.log(`[Tailscale] login authUrl detected (${source})`);
        resolveOnce({ authUrl: url });
        if (child?.exitCode === null && !child.killed) child.unref();
        clearTimeout(timeout);
        // Browser OAuth needs longer than the short daemon/AuthURL discovery
        // phase. Keep exactly one owned session for this bounded window.
        timeout = setTimeout(() => {
          closeSession({ reason: "browser login session timed out", terminate: true });
        }, LOGIN_AUTH_SESSION_TIMEOUT_MS);
      }
      return true;
    };

    const scheduleStatusPoll = () => {
      if (!closed) {
        const delay = session.authUrl ? LOGIN_AUTH_STATUS_POLL_MS : LOGIN_STATUS_POLL_MS;
        statusPollTimer = setTimeout(() => { void pollStatus(); }, delay);
      }
    };

    const pollStatus = async () => {
      if (closed || statusPollInFlight) return;
      statusPollInFlight = true;
      try {
        const status = await getTailscaleBackendStatus({ force: true });
        if (closed) return;
        if (status?.AuthURL) finishWithUrl(status.AuthURL, "status");
        if (isBackendLoggedIn(status)) {
          confirmLogin();
        }
      } catch {
        // The bounded poll below retries while the daemon publishes AuthURL.
      } finally {
        statusPollInFlight = false;
        scheduleStatusPoll();
      }
    };

    try {
      const args = tsArgs("up", "--accept-routes");
      if (hostname) args.push(`--hostname=${hostname}`);
      child = spawn(bin, args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
        windowsHide: true,
      });
      session.child = child;
    } catch (error) {
      closeSession({ reason: "login spawn error", error, terminate: true });
      return;
    }

    const handleData = (data) => {
      output = `${output}${data}`.slice(-MAX_LOGIN_OUTPUT_BYTES);
      finishWithUrl(parseAuthUrl(output), "stdout");
    };
    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);

    child.on("error", (error) => {
      console.error(`[Tailscale] login spawn error: ${error.message}`);
      closeSession({ reason: "login spawn error", error, terminate: true });
    });

    child.on("exit", (code) => {
      if (closed) return;
      console.log(`[Tailscale] login exit code=${code}`);
      const url = parseAuthUrl(output);
      if (url) finishWithUrl(url, "exit");
      // A Windows `tailscale up` may exit before AuthURL reaches status; the
      // scheduled single-flight poll remains active until the hard timeout.
    });

    timeout = setTimeout(() => {
      const url = parseAuthUrl(output);
      if (url) finishWithUrl(url, "timeout-output");
      else closeSession({
        reason: "tailscale up timed out without auth URL",
        error: new Error("tailscale up timed out without auth URL"),
        terminate: true,
      });
    }, LOGIN_TIMEOUT_MS);

    session.cancel = (reason) => {
      closeSession({
        reason,
        error: responseSettled ? null : new Error(reason),
        terminate: true,
      });
    };
    void pollStatus();
  });

  session.promise = promise;
  // The caller normally awaits this, but keeping a no-op rejection handler
  // prevents an abandoned route invocation from becoming an unhandled error.
  promise.catch(() => {});
  return promise;
}

let activeFunnelOperation = null;

/** Start tailscale funnel for the given port. Concurrent recovery callers share one child. */
export function startFunnel(port) {
  if (activeFunnelOperation) return activeFunnelOperation.promise;

  const operation = {
    port,
    child: null,
    cancelled: false,
    abort: null,
    promise: null,
  };
  operation.cancel = (reason) => {
    operation.cancelled = true;
    if (operation.abort) operation.abort(reason);
    else terminateManagedChild(operation.child, reason);
  };

  const promise = startFunnelImpl(port, operation);
  operation.promise = promise;
  activeFunnelOperation = operation;
  promise.finally(() => {
    if (activeFunnelOperation === operation) activeFunnelOperation = null;
  }).catch(() => {});
  return promise;
}

async function startFunnelImpl(port, operation) {
  const bin = getTailscaleBin();
  if (!bin) throw new Error("Tailscale not installed");

  // Reset any existing funnel
  try {
    await runTailscale(bin, tsArgs("funnel", "--bg", "reset"), { timeout: 5000 });
  } catch { /* no previous funnel is fine */ }
  if (operation.cancelled) throw new Error("tailscale funnel cancelled");
  invalidateStatusCache();

  return new Promise((resolve, reject) => {
    if (operation.cancelled) {
      reject(new Error("tailscale funnel cancelled"));
      return;
    }
    const child = spawn(bin, tsArgs("funnel", "--bg", `${port}`), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    operation.child = child;

    let resolved = false;
    let urlResolutionPromise = null;
    let output = "";
    let timeout;
    let abort;

    const settle = ({ result, error }) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      if (operation.abort === abort) operation.abort = null;
      if (error) reject(error);
      else resolve(result);
    };

    abort = (reason) => {
      if (resolved) return;
      terminateManagedChild(child, reason);
      settle({ error: new Error("tailscale funnel cancelled") });
    };
    operation.abort = abort;

    // Always resolve via Self.DNSName to get the real hostname (avoids -1 suffix from conflicts).
    // Only one status lookup can be active, even if stdout and exit arrive together.
    const resolveUrl = ({ force = false, fallback = false } = {}) => {
      if (resolved) return Promise.resolve(false);
      if (urlResolutionPromise) return urlResolutionPromise;

      const resolution = (async () => {
        try {
          const url = await getActualFunnelUrl({ force });
          if (url) {
            settle({ result: { tunnelUrl: url } });
            return true;
          }
          if (fallback) {
            const cachedUrl = getTailscaleFunnelUrl(port);
            if (cachedUrl) {
              settle({ result: { tunnelUrl: cachedUrl } });
              return true;
            }
          }
          return false;
        } catch {
          return false;
        }
      })();

      urlResolutionPromise = resolution;
      return resolution.finally(() => {
        if (urlResolutionPromise === resolution) urlResolutionPromise = null;
      });
    };

    timeout = setTimeout(() => {
      void (async () => {
        const found = await resolveUrl({ force: true, fallback: true });
        if (!found) {
          terminateManagedChild(child, "funnel timeout");
          settle({ error: new Error(`Tailscale funnel timed out: ${output.trim() || "no output"}`) });
        }
      })();
    }, 30000);

    let funnelNotEnabled = false;

    const handleData = (data) => {
      output = `${output}${data}`.slice(-MAX_LOGIN_OUTPUT_BYTES);

      if (output.includes("Funnel is not enabled")) funnelNotEnabled = true;

      // Wait for the enable URL to arrive in a later chunk
      if (funnelNotEnabled && !resolved) {
        const enableMatch = output.match(/https:\/\/login\.tailscale\.com\/[^\s]+/);
        if (enableMatch) {
          child.kill();
          settle({ result: { funnelNotEnabled: true, enableUrl: enableMatch[0] } });
          return;
        }
      }

      void resolveUrl();
    };

    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);

    child.on("exit", (code) => {
      if (resolved) return;
      console.log(`[Tailscale] funnel exit code=${code} output="${output.trim().slice(0, 200)}"`);
      void (async () => {
        const found = await resolveUrl({ force: true, fallback: true });
        if (!found) {
          terminateManagedChild(child, `funnel exit ${code}`);
          settle({ error: new Error(`tailscale funnel failed (code ${code}): ${output.trim()}`) });
        }
      })();
    });

    child.on("error", (err) => {
      terminateManagedChild(child, "funnel spawn error");
      settle({ error: err });
    });
  });
}

/** Provision TLS cert for funnel domain (required before Funnel serves HTTPS). Best-effort. */
export async function provisionCert(hostname) {
  const bin = getTailscaleBin();
  if (!bin || !hostname) return;
  const certsDir = path.join(TAILSCALE_DIR, "certs");
  fs.mkdirSync(certsDir, { recursive: true });
  const certFile = path.join(certsDir, `${hostname}.crt`);
  const keyFile = path.join(certsDir, `${hostname}.key`);
  try {
    await runTailscale(bin, [...SOCKET_FLAG, "cert", "--cert-file", certFile, "--key-file", keyFile, hostname], {
      timeout: 30000,
    });
    console.log(`[Tailscale] cert provisioned for ${hostname}`);
  } catch (e) {
    console.warn(`[Tailscale] cert provision failed (non-fatal): ${e.message}`);
  }
}

/** Stop tailscale funnel */
export async function stopFunnel() {
  // A disable/reset may arrive while watchdog recovery is still creating a
  // funnel. Cancel that operation first so it cannot spawn after this reset.
  activeFunnelOperation?.cancel("funnel stopped");
  const bin = getTailscaleBin();
  if (!bin) return;
  try {
    await runTailscale(bin, tsArgs("funnel", "--bg", "reset"), { timeout: 5000 });
  } catch { /* no active funnel is fine */ }
  invalidateStatusCache();
}

/** Kill tailscaled daemon (runs as root, needs sudo) */
export async function stopDaemon(sudoPassword) {
  // Windows owns tailscaled as a system service. Never probe it with Unix
  // `pkill`/`pgrep`, which otherwise causes cmd.exe attempts on every stop.
  if (IS_WINDOWS) return;

  // Try non-sudo first
  try { runExecutableSync("pkill", ["-x", "tailscaled"], { stdio: "ignore", timeout: 3000 }); } catch { /* ignore */ }

  // Check if still alive
  try { runExecutableSync("pgrep", ["-x", "tailscaled"], { stdio: "ignore", timeout: 2000 }); } catch { return; } // Dead, done

  // Kill with sudo password
  if (!IS_WINDOWS) {
    try { await execWithPassword("pkill -x tailscaled", sudoPassword || ""); } catch { /* ignore */ }
  }

  // Cleanup socket
  try { if (fs.existsSync(TAILSCALE_SOCKET)) fs.unlinkSync(TAILSCALE_SOCKET); } catch { /* ignore */ }
}
