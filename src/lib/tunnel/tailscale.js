import fs from "fs";
import path from "path";
import os from "os";
import { execSync, exec, spawn } from "child_process";
import { promisify } from "util";
import { execWithPassword } from "@/mitm/dns/dnsConfig";
import { saveTailscalePid, loadTailscalePid, clearTailscalePid } from "./state.js";
import { DATA_DIR } from "@/lib/dataDir.js";

const execAsync = promisify(exec);

const BIN_DIR = path.join(DATA_DIR, "bin");
const IS_MAC = os.platform() === "darwin";
const IS_LINUX = os.platform() === "linux";
const IS_WINDOWS = os.platform() === "win32";
const TAILSCALE_BIN = path.join(BIN_DIR, IS_WINDOWS ? "tailscale.exe" : "tailscale");

// Custom socket for userspace-networking mode (no root required)
const TAILSCALE_DIR = path.join(DATA_DIR, "tailscale");
export const TAILSCALE_SOCKET = path.join(TAILSCALE_DIR, "tailscaled.sock");
const SOCKET_FLAG = IS_WINDOWS ? [] : ["--socket", TAILSCALE_SOCKET];

// Well-known Windows install path
const WINDOWS_TAILSCALE_BIN = "C:\\Program Files\\Tailscale\\tailscale.exe";

// Common Unix install paths to probe synchronously (system tailscale)
const UNIX_TAILSCALE_CANDIDATES = [
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/bin/tailscale",
];

// ─── Cache + background refresh (avoid blocking event loop on dead daemon) ──
const PROBE_TTL_MS = 10000;
const PROBE_TIMEOUT_MS = 1500;

const binCache = { value: undefined, fetchedAt: 0, refreshing: false };
const runningCache = { value: false, fetchedAt: 0, refreshing: false };
const funnelUrlCache = { value: null, port: null, fetchedAt: 0, refreshing: false };

function fallbackBin() {
  if (fs.existsSync(TAILSCALE_BIN)) return TAILSCALE_BIN;
  if (IS_WINDOWS && fs.existsSync(WINDOWS_TAILSCALE_BIN)) return WINDOWS_TAILSCALE_BIN;
  if (!IS_WINDOWS) return UNIX_TAILSCALE_CANDIDATES.find((p) => fs.existsSync(p)) || null;
  return null;
}

function bgRefreshBin() {
  if (binCache.refreshing) return;
  binCache.refreshing = true;
  execAsync("which tailscale 2>/dev/null || where tailscale 2>nul", { windowsHide: true, timeout: PROBE_TIMEOUT_MS })
    .then(({ stdout }) => {
      const sys = stdout.trim();
      binCache.value = sys || fallbackBin();
    })
    .catch(() => { binCache.value = fallbackBin(); })
    .finally(() => {
      binCache.fetchedAt = Date.now();
      binCache.refreshing = false;
    });
}

// Sync getter: returns cached value, triggers background refresh if stale
function getTailscaleBin() {
  if (Date.now() - binCache.fetchedAt > PROBE_TTL_MS) bgRefreshBin();
  // First call: synchronously probe common install paths (no exec, no event-loop block)
  if (binCache.value === undefined) {
    if (fs.existsSync(TAILSCALE_BIN)) binCache.value = TAILSCALE_BIN;
    else if (IS_WINDOWS && fs.existsSync(WINDOWS_TAILSCALE_BIN)) binCache.value = WINDOWS_TAILSCALE_BIN;
    else if (!IS_WINDOWS) {
      const found = UNIX_TAILSCALE_CANDIDATES.find((p) => fs.existsSync(p));
      binCache.value = found || null;
    } else binCache.value = null;
  }
  return binCache.value;
}

export function isTailscaleInstalled() {
  return getTailscaleBin() !== null;
}

/** Build tailscale CLI args with custom socket (no root needed) */
function tsArgs(...args) {
  return [...SOCKET_FLAG, ...args];
}

export function isTailscaleLoggedIn() {
  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    const out = execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
      timeout: 5000
    });
    const json = JSON.parse(out);
    // BackendState=Running + Self.Online=true → device still exists in tailnet
    return json.BackendState === "Running" && json.Self?.Online === true;
  } catch (e) {
    return false;
  }
}

function bgRefreshRunning() {
  if (runningCache.refreshing) return;
  const bin = getTailscaleBin();
  if (!bin) {
    runningCache.value = false;
    runningCache.fetchedAt = Date.now();
    return;
  }
  runningCache.refreshing = true;
  execAsync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel status --json`, { windowsHide: true, timeout: PROBE_TIMEOUT_MS })
    .then(({ stdout }) => {
      try {
        const json = JSON.parse(stdout);
        runningCache.value = Object.keys(json.AllowFunnel || {}).length > 0;
      } catch { runningCache.value = false; }
    })
    .catch(() => { runningCache.value = false; })
    .finally(() => {
      runningCache.fetchedAt = Date.now();
      runningCache.refreshing = false;
    });
}

// Sync getter: never blocks; returns last known state, refreshes in background
export function isTailscaleRunning() {
  if (Date.now() - runningCache.fetchedAt > PROBE_TTL_MS) bgRefreshRunning();
  return runningCache.value;
}

// Synchronous strict probe for hot user-initiated paths (enable/connect flow).
// Blocks ~PROBE_TIMEOUT_MS at most; updates cache as a side effect.
export function isTailscaleRunningStrict() {
  const bin = getTailscaleBin();
  if (!bin) return false;
  try {
    const out = execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel status --json 2>/dev/null`, {
      encoding: "utf8",
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
    });
    const json = JSON.parse(out);
    const running = Object.keys(json.AllowFunnel || {}).length > 0;
    runningCache.value = running;
    runningCache.fetchedAt = Date.now();
    return running;
  } catch {
    return false;
  }
}

function bgRefreshFunnelUrl(port) {
  if (funnelUrlCache.refreshing) return;
  const bin = getTailscaleBin();
  if (!bin) return;
  funnelUrlCache.refreshing = true;
  execAsync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, { windowsHide: true, timeout: PROBE_TIMEOUT_MS })
    .then(({ stdout }) => {
      try {
        const json = JSON.parse(stdout);
        const dnsName = json.Self?.DNSName?.replace(/\.$/, "");
        funnelUrlCache.value = dnsName ? `https://${dnsName}` : null;
      } catch { /* keep prev */ }
    })
    .catch(() => { /* keep prev */ })
    .finally(() => {
      funnelUrlCache.port = port;
      funnelUrlCache.fetchedAt = Date.now();
      funnelUrlCache.refreshing = false;
    });
}

/** Get actual funnel URL from Self.DNSName (sync, authoritative — avoids hostname-conflict suffix). */
function getActualFunnelUrl() {
  const bin = getTailscaleBin();
  if (!bin) return null;
  try {
    const out = execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
      timeout: 5000,
    });
    const json = JSON.parse(out);
    const dnsName = json.Self?.DNSName?.replace(/\.$/, "");
    return dnsName ? `https://${dnsName}` : null;
  } catch { return null; }
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

const EXTENDED_PATH = `/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH || ""}`;

function hasBrew() {
  try { execSync("which brew", { stdio: "ignore", windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH } }); return true; } catch { return false; }
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
      try { execSync(`rm -f ${pkgPath}`, { stdio: "ignore", windowsHide: true }); } catch { /* ignore */ }
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
      const child = spawn("sudo", ["-S", "sh"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let stderr = "";
      child.stdout.on("data", (d) => {
        const line = d.toString().trim();
        if (line) log(line);
      });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("close", (c) => {
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
      child.stdin.write(scriptContent);
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
      "-NoProfile", "-NonInteractive", "-Command",
      `Start-Process msiexec -ArgumentList ${args} -Verb RunAs -Wait`
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
      execSync(`chown -R ${uid}:${gid} "${dir}"`, { stdio: "ignore", timeout: 3000 });
    } catch {
      try { execSync(`sudo -n chown -R ${uid}:${gid} "${dir}"`, { stdio: "ignore", timeout: 3000 }); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

/** Check if running daemon uses TUN mode (Funnel TLS requires TUN). */
function isDaemonTunMode() {
  try {
    const ps = execSync(`pgrep -af "tailscaled.*${TAILSCALE_SOCKET}"`, { encoding: "utf8", timeout: 2000 }).trim();
    if (!ps) return null;
    return !ps.includes("--tun=userspace-networking");
  } catch { return null; }
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
    try { execSync("net start Tailscale", { stdio: "ignore", windowsHide: true, timeout: 10000 }); }
    catch { /* may need admin, or already running */ }
    if (!bin) return;
    // Poll up to ~10s for backend to leave NoState
    for (let i = 0; i < 20; i++) {
      try {
        const out = execSync(`"${bin}" status --json`, { encoding: "utf8", windowsHide: true, timeout: 2000 });
        const j = JSON.parse(out);
        if (j.BackendState && j.BackendState !== "NoState") {
          console.log(`[Tailscale] win: BackendState=${j.BackendState} after ${i*500}ms`);
          return;
        }
      } catch { /* daemon not ready */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.log("[Tailscale] win: BackendState still NoState after poll");
    return;
  }

  const wantTun = !!sudoPassword;
  const currentMode = isDaemonTunMode(); // true=TUN, false=userspace, null=not running

  // Daemon already running in correct mode → reuse
  if (currentMode !== null && currentMode === wantTun) {
    try {
      const bin = getTailscaleBin() || "tailscale";
      execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
        stdio: "ignore", windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH }, timeout: 3000
      });
      return;
    } catch { /* unresponsive, restart below */ }
  }

  // Mode mismatch or unresponsive → kill all daemons on our socket
  try { execSync(`pkill -9 -f "tailscaled.*${TAILSCALE_SOCKET}"`, { stdio: "ignore", timeout: 3000 }); } catch { /* ignore */ }
  if (sudoPassword) {
    try { await execWithPassword(`pkill -9 -f "tailscaled.*${TAILSCALE_SOCKET}"`, sudoPassword); } catch { /* ignore */ }
  } else {
    try { execSync(`sudo -n pkill -9 -f "tailscaled.*${TAILSCALE_SOCKET}"`, { stdio: "ignore", timeout: 3000 }); } catch { /* ignore */ }
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

/** Read AuthURL from `tailscale status --json` (Win exposes it there, not stdout). */
function getAuthUrlFromStatus() {
  const bin = getTailscaleBin();
  if (!bin) return null;
  try {
    const out = execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} status --json`, {
      encoding: "utf8", windowsHide: true, timeout: 2000
    });
    const j = JSON.parse(out);
    if (j.AuthURL) return j.AuthURL;
    return null;
  } catch { return null; }
}

/**
 * Run `tailscale up` and capture the auth URL for browser login.
 * Resolves with { authUrl } or { alreadyLoggedIn: true }.
 * On Windows, AuthURL comes from `status --json` (not stdout) — must poll status.
 */
export function startLogin(hostname) {
  const bin = getTailscaleBin();
  if (!bin) return Promise.reject(new Error("Tailscale not installed"));

  return new Promise((resolve, reject) => {
    // Ensure daemon is running (best-effort, no sudo)
    ensureDaemon();

    // Check if already logged in
    if (isTailscaleLoggedIn()) {
      resolve({ alreadyLoggedIn: true });
      return;
    }

    // Force re-auth on Win when device may have been removed from tailnet
    const args = tsArgs("up", "--accept-routes", "--force-reauth");
    if (hostname) args.push(`--hostname=${hostname}`);
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      windowsHide: true
    });

    let resolved = false;
    let output = "";

    const parseAuthUrl = (text) => {
      const match = text.match(/https:\/\/login\.tailscale\.com\/a\/[a-zA-Z0-9]+/);
      return match ? match[0] : null;
    };

    const finishWithUrl = (url, source) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearInterval(statusPoll);
      console.log(`[Tailscale] login authUrl detected (${source})`);
      child.unref();
      resolve({ authUrl: url });
    };

    // Poll status --json every 500ms — Windows exposes AuthURL only there
    const statusPoll = setInterval(() => {
      if (resolved) return;
      const url = getAuthUrlFromStatus();
      if (url) finishWithUrl(url, "status");
    }, 500);

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      clearInterval(statusPoll);
      child.unref();
      const url = parseAuthUrl(output) || getAuthUrlFromStatus();
      if (url) resolve({ authUrl: url });
      else reject(new Error("tailscale up timed out without auth URL"));
    }, 15000);

    const handleData = (data) => {
      output += data.toString();
      const url = parseAuthUrl(output);
      if (url) finishWithUrl(url, "stdout");
    };

    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      clearInterval(statusPoll);
      console.error(`[Tailscale] login spawn error: ${err.message}`);
      reject(err);
    });

    child.on("exit", (code) => {
      if (resolved) return;
      console.log(`[Tailscale] login exit code=${code}`);
      // Don't trust exit code alone — Win `tailscale up` exits 0 even when not logged in.
      // Let status poll continue until AuthURL appears or timeout.
      const url = parseAuthUrl(output) || getAuthUrlFromStatus();
      if (url) {
        finishWithUrl(url, "exit");
        return;
      }
      // Only resolve alreadyLoggedIn if status confirms BackendState=Running
      if (isTailscaleLoggedIn()) {
        resolved = true;
        clearTimeout(timeout);
        clearInterval(statusPoll);
        resolve({ alreadyLoggedIn: true });
        return;
      }
      // Otherwise keep polling — daemon may publish AuthURL shortly after exit
    });
  });
}

/** Start tailscale funnel for the given port */
export async function startFunnel(port) {
  const bin = getTailscaleBin();
  if (!bin) throw new Error("Tailscale not installed");

  // Reset any existing funnel
  try { execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel --bg reset`, { stdio: "ignore", windowsHide: true }); } catch (e) { /* ignore */ }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, tsArgs("funnel", "--bg", `${port}`), {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let resolved = false;
    let output = "";

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      // --bg exits after setup, read actual hostname from status
      const url = getActualFunnelUrl() || getTailscaleFunnelUrl(port);
      if (url) resolve({ tunnelUrl: url });
      else reject(new Error(`Tailscale funnel timed out: ${output.trim() || "no output"}`));
    }, 30000);

    // Always resolve via Self.DNSName to get the real hostname (avoids -1 suffix from conflicts)
    const parseFunnelUrl = () => getActualFunnelUrl();

    let funnelNotEnabled = false;

    const handleData = (data) => {
      output += data.toString();

      if (output.includes("Funnel is not enabled")) funnelNotEnabled = true;

      // Wait for the enable URL to arrive in a later chunk
      if (funnelNotEnabled && !resolved) {
        const enableMatch = output.match(/https:\/\/login\.tailscale\.com\/[^\s]+/);
        if (enableMatch) {
          resolved = true;
          clearTimeout(timeout);
          child.kill();
          resolve({ funnelNotEnabled: true, enableUrl: enableMatch[0] });
          return;
        }
      }

      const url = parseFunnelUrl();
      if (url && !resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ tunnelUrl: url });
      }
    };

    child.stdout.on("data", handleData);
    child.stderr.on("data", handleData);

    child.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      console.log(`[Tailscale] funnel exit code=${code} output="${output.trim().slice(0, 200)}"`);
      const url = parseFunnelUrl() || getTailscaleFunnelUrl(port);
      if (url) resolve({ tunnelUrl: url });
      else reject(new Error(`tailscale funnel failed (code ${code}): ${output.trim()}`));
    });

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      reject(err);
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
    await execAsync(
      `"${bin}" ${SOCKET_FLAG.join(" ")} cert --cert-file "${certFile}" --key-file "${keyFile}" "${hostname}"`,
      { windowsHide: true, env: { ...process.env, PATH: EXTENDED_PATH }, timeout: 30000 }
    );
    console.log(`[Tailscale] cert provisioned for ${hostname}`);
  } catch (e) {
    console.warn(`[Tailscale] cert provision failed (non-fatal): ${e.message}`);
  }
}

/** Stop tailscale funnel */
export function stopFunnel() {
  const bin = getTailscaleBin();
  if (!bin) return;
  try { execSync(`"${bin}" ${SOCKET_FLAG.join(" ")} funnel --bg reset`, { stdio: "ignore", windowsHide: true }); } catch (e) { /* ignore */ }
}

/** Kill tailscaled daemon (runs as root, needs sudo) */
export async function stopDaemon(sudoPassword) {
  // Try non-sudo first
  try { execSync("pkill -x tailscaled", { stdio: "ignore", windowsHide: true, timeout: 3000 }); } catch { /* ignore */ }

  // Check if still alive
  try { execSync("pgrep -x tailscaled", { stdio: "ignore", windowsHide: true, timeout: 2000 }); } catch { return; } // Dead, done

  // Kill with sudo password
  if (!IS_WINDOWS) {
    try { await execWithPassword("pkill -x tailscaled", sudoPassword || ""); } catch { /* ignore */ }
  }

  // Cleanup socket
  try { if (fs.existsSync(TAILSCALE_SOCKET)) fs.unlinkSync(TAILSCALE_SOCKET); } catch { /* ignore */ }
}
