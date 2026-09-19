import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { UPDATER_CONFIG } from "@/shared/constants/config";

const KILL_TIMEOUT_MS = 5000;
const PROCESS_WAIT_MS = 1500;
const DEFAULT_APP_PORT = "20128";

// ── Process ownership (F23/T1.6 M2) ─────────────────────────────────────────
//
// Mirrors the launcher's matcher in cli/cli.js (kept as an independent copy:
// cli/ is a standalone npm package and cannot import from the server bundle —
// tests/unit/f23-appupdater-ownership.test.js pins both against ONE shared
// case matrix so they cannot drift the way the /api/version compare did in
// H1). The old matcher accepted any cmdline containing "9router", "next-server",
// "cloudflared" or "cli.js" and SIGKILLed it — taking down every unrelated
// Next.js server on the host, anyone tailing this app's log, and the user's
// own tunnels to other ports. A process is ours only by FACT: exact installed
// path in argv, cwd equal to this app's directory, or a cloudflared aimed at
// THIS app's port.

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

// entry: { pid, cmd, cwd? } — opts: { selfPid, ownedPaths, ownedDirs,
// caseInsensitive, resolveCwd? }
export function isOwnAppProcess(entry, opts = {}) {
  if (!entry || entry.pid == null) return false;
  const { selfPid = null, ownedPaths = [], ownedDirs = [], caseInsensitive = false, resolveCwd = null } = opts;
  if (selfPid != null && String(entry.pid) === String(selfPid)) return false;
  const cmd = String(entry.cmd || "");

  for (const p of ownedPaths) {
    if (cmdContainsExactPath(cmd, p, { caseInsensitive })) return true;
  }
  for (const d of ownedDirs) {
    if (!d) continue;
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

export function parsePidCommand(line) {
  const m = /^\s*(\d+)\s+(\S.*)$/.exec(String(line));
  if (!m) return null;
  return { pid: m[1], cmd: m[2] };
}

export function parseWmiCsvEntry(line) {
  const m = /^\s*"(\d+)","(.*)"\s*$/.exec(String(line));
  if (!m) return null;
  return { pid: m[1], cmd: m[2].replace(/""/g, '"') };
}

// cloudflared is only ours when it fronts THIS app's port — a bare
// "cloudflared" substring used to kill the user's tunnels to other services.
export function collectTunnelPids(entries, port) {
  const p = String(port || DEFAULT_APP_PORT);
  const re = new RegExp(`(?:localhost|127\\.0\\.0\\.1):${p}(?!\\d)`);
  const out = [];
  for (const e of entries || []) {
    if (!e || !e.cmd) continue;
    if (!/\bcloudflared\b/i.test(e.cmd)) continue;
    if (re.test(e.cmd)) out.push(String(e.pid));
  }
  return out;
}

// Facts about this installation as seen from inside the running server.
function installOwnership() {
  const appDir = process.cwd(); // standalone server runs with cwd = <install>/cli/app
  const installCliDir = path.resolve(appDir, "..");
  const ownScript = process.argv[1] ? path.resolve(process.argv[1]) : null;
  return {
    selfPid: process.pid,
    ownedPaths: [ownScript, path.join(installCliDir, "cli.js")].filter(Boolean),
    ownedDirs: [appDir, installCliDir, path.join(getDataDir(), "runtime", "node_modules")],
    caseInsensitive: process.platform === "win32",
    resolveCwd: process.platform === "linux" ? readProcCwd : null,
  };
}

function readProcCwd(pid) {
  try { return fs.realpathSync(`/proc/${pid}/cwd`); } catch { return null; }
}

// Collect PIDs of all 9router processes of THIS install (excluding current)
function collectAppPids() {
  const platform = process.platform;
  const port = process.env.PORT || DEFAULT_APP_PORT;
  const opts = installOwnership();
  const entries = [];

  if (platform === "win32") {
    // One WMI pass, full CommandLine (tasklist /V doesn't include it).
    try {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "Get-WmiObject Win32_Process -Filter 'Name=\\"node.exe\\" OR Name=\\"tray_windows_release.exe\\" OR Name=\\"cloudflared.exe\\"' | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"`;
      const output = execSync(psCmd, { encoding: "utf8", windowsHide: true, timeout: KILL_TIMEOUT_MS });
      for (const line of output.split("\n").slice(1)) {
        const e = parseWmiCsvEntry(line);
        if (e) entries.push(e);
      }
    } catch { /* no processes */ }
  } else {
    try {
      // `ps aux` leaks the USER column into the matched string (a user named
      // "9router" qualified for the kill); pin pid + argv instead.
      const output = execSync("ps -eo pid=,command= 2>/dev/null", { encoding: "utf8", timeout: KILL_TIMEOUT_MS });
      for (const line of output.split("\n")) {
        const e = parsePidCommand(line);
        if (e) entries.push(e);
      }
    } catch { /* no processes */ }
  }

  const owned = entries.filter((e) => isOwnAppProcess(e, opts)).map((e) => String(e.pid));
  const tunnels = collectTunnelPids(entries, port);
  return [...new Set([...owned, ...tunnels])].filter((pid) => pid !== String(process.pid));
}

// Kill MITM server by PID file (MITM may run as admin/sudo)
function killMitmByPidFile() {
  try {
    const mitmPidFile = path.join(
      process.platform === "win32"
        ? path.join(process.env.APPDATA || "", "9router")
        : path.join(os.homedir(), ".9router"),
      "mitm",
      ".mitm.pid"
    );
    if (!fs.existsSync(mitmPidFile)) return;
    const pid = parseInt(fs.readFileSync(mitmPidFile, "utf8").trim(), 10);
    if (!pid) return;

    if (process.platform === "win32") {
      // taskkill first (works if same user); fallback to PowerShell Stop-Process which can kill admin process if our token allows
      try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 3000 }); } catch {
        try { execSync(`powershell -NonInteractive -WindowStyle Hidden -Command "Stop-Process -Id ${pid} -Force"`, { stdio: "ignore", windowsHide: true, timeout: 3000 }); } catch { /* best effort */ }
      }
    } else {
      try {
        execSync(`sudo -n kill -9 ${pid} 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
      } catch {
        try { process.kill(pid, "SIGKILL"); } catch { /* best effort */ }
      }
    }
    try { fs.unlinkSync(mitmPidFile); } catch { /* best effort */ }
  } catch { /* best effort */ }
}

// Collect PIDs of all 9router-related processes (excluding current)
// → replaced by installOwnership()/isOwnAppProcess above (F23/T1.6 M2):
// exact installed paths, cwd of the standalone app dir, and cloudflared
// tunnels aimed at THIS app's port. Never "9router"/"next-server" substrings.

// Copy updater.js into DATA_DIR so npm -g can overwrite node_modules safely
function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}

function resolveBundledUpdaterPath() {
  if (process.env.UPDATER_SCRIPT_PATH && fs.existsSync(process.env.UPDATER_SCRIPT_PATH)) {
    return process.env.UPDATER_SCRIPT_PATH;
  }
  // Production standalone: cwd is binAppDir (see bin/cli.js)
  // Dev: cwd is app/
  const fromCwd = path.join(process.cwd(), "src", "lib", "updater", "updater.js");
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromParent = path.join(process.cwd(), "..", "src", "lib", "updater", "updater.js");
  if (fs.existsSync(fromParent)) return fromParent;
  return fromCwd;
}

function ensureRuntimeUpdater(bundledPath) {
  try {
    if (!bundledPath || !fs.existsSync(bundledPath)) return bundledPath;
    const runtimeDir = path.join(getDataDir(), "runtime", "updater");
    const runtimePath = path.join(runtimeDir, "updater.js");
    if (fs.existsSync(runtimePath)) {
      try {
        if (fs.statSync(bundledPath).size === fs.statSync(runtimePath).size) return runtimePath;
      } catch { /* recopy */ }
    }
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.copyFileSync(bundledPath, runtimePath);
    return runtimePath;
  } catch {
    return bundledPath;
  }
}

// Kill all app-related processes to release file locks (esp. on Windows)
export async function killAppProcesses() {
  killMitmByPidFile();
  const pids = collectAppPids();
  const platform = process.platform;

  pids.forEach(pid => {
    try {
      if (platform === "win32") {
        execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: "ignore", shell: true, windowsHide: true, timeout: 3000 });
      } else {
        execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
      }
    } catch { /* already dead */ }
  });

  if (pids.length > 0) {
    await new Promise(r => setTimeout(r, PROCESS_WAIT_MS));
  }
}

// Resolve npx/9router binary to relaunch after update (cross-platform)
function resolveRelaunchCommand() {
  const isWin = process.platform === "win32";
  // Prefer `npx 9router` — works regardless of global bin path changes after npm i -g
  const npx = isWin ? "npx.cmd" : "npx";
  return { cmd: npx, args: [UPDATER_CONFIG.npmPackageName] };
}

// Spawn detached headless updater (Node process) then exit current server
export function spawnUpdaterAndExit(packageName = UPDATER_CONFIG.npmPackageName) {
  const updaterPath = ensureRuntimeUpdater(resolveBundledUpdaterPath());
  const isTray = process.env.TRAY_MODE === "1";
  const relaunch = resolveRelaunchCommand();
  // Relaunch matching original env: tray stays tray, foreground stays foreground
  const relaunchArgs = isTray
    ? [...relaunch.args, "--tray", "--skip-update"]
    : [...relaunch.args, "--skip-update"];

  spawn(process.execPath, [updaterPath], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      UPDATER_PKG_NAME: packageName,
      UPDATER_PORT: String(UPDATER_CONFIG.statusPort),
      UPDATER_TAIL_LINES: String(UPDATER_CONFIG.statusLogTailLines),
      UPDATER_RETRIES: String(UPDATER_CONFIG.installRetries),
      UPDATER_RETRY_DELAY_MS: String(UPDATER_CONFIG.installRetryDelayMs),
      UPDATER_LINGER_MS: String(UPDATER_CONFIG.lingerAfterDoneMs),
      UPDATER_WAIT_MIN_MS: String(UPDATER_CONFIG.waitForExitMinMs),
      UPDATER_WAIT_MAX_MS: String(UPDATER_CONFIG.waitForExitMaxMs),
      UPDATER_WAIT_CHECK_MS: String(UPDATER_CONFIG.waitForExitCheckMs),
      UPDATER_APP_PORT: String(UPDATER_CONFIG.appPort),
      UPDATER_RELAUNCH: "1",
      UPDATER_RELAUNCH_CMD: relaunch.cmd,
      UPDATER_RELAUNCH_ARGS: JSON.stringify(relaunchArgs),
    },
  }).unref();

  setTimeout(() => process.exit(0), UPDATER_CONFIG.exitDelayMs);
}
