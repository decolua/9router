import https from "https";
import { execFileSync, spawn, spawnSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { UPDATER_CONFIG } from "@/shared/constants/config";

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getProcessName(pid) {
  try {
    if (process.platform === "win32") {
      const output = execFileSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
      });
      return output.match(/"([^"]+)"/)?.[1]?.replace(/\.exe$/i, "").toLowerCase() || null;
    }
    return execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim().split(/\s+/).at(-1)?.toLowerCase() || null;
  } catch {
    return null;
  }
}

function terminatePid(pid) {
  try {
    if (process.platform === "win32") {
      const result = spawnSync("taskkill.exe", ["/T", "/F", "/PID", String(pid)], {
        windowsHide: true,
        stdio: "ignore",
        timeout: 3000,
      });
      return result.status === 0;
    }
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function removePidFile(pidFile) {
  try { fs.unlinkSync(pidFile); } catch { /* best effort */ }
}

function readPidFile(pidFile) {
  try {
    if (!fs.existsSync(pidFile)) return null;
    const pid = Number.parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function stopExpectedPidFile(pidFile, expectedNames) {
  const pid = readPidFile(pidFile);
  if (!pid) return false;
  if (!isPidAlive(pid)) {
    removePidFile(pidFile);
    return false;
  }
  const name = getProcessName(pid);
  if (!name || !expectedNames.includes(name)) {
    console.warn(`[Updater] Refusing to stop PID ${pid}: expected ${expectedNames.join("/")}, found ${name || "unknown"}`);
    return false;
  }
  const stopped = terminatePid(pid);
  if (stopped) removePidFile(pidFile);
  return stopped;
}

async function isHealthyMitmPid(pid) {
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
        try { resolve(response.statusCode === 200 && JSON.parse(body).pid === pid); }
        catch { resolve(false); }
      });
    });
    request.once("error", () => resolve(false));
    request.once("timeout", () => { request.destroy(); resolve(false); });
  });
}

async function stopMitmPidFile(pidFile) {
  const pid = readPidFile(pidFile);
  if (!pid) return false;
  if (!isPidAlive(pid)) {
    removePidFile(pidFile);
    return false;
  }
  if (!(await isHealthyMitmPid(pid))) {
    console.warn(`[Updater] Refusing to stop unverified MITM PID ${pid}`);
    return false;
  }
  const stopped = terminatePid(pid);
  if (stopped) removePidFile(pidFile);
  return stopped;
}


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

// Stop only services explicitly owned by this 9router data directory. The old
// updater scanned every Node/Next process and could kill unrelated projects.
export async function killAppProcesses() {
  const dataDir = getDataDir();
  const stopped = [
    await stopMitmPidFile(path.join(dataDir, "mitm", ".mitm.pid")),
    stopExpectedPidFile(path.join(dataDir, "tunnel", "cloudflared.pid"), ["cloudflared"]),
    stopExpectedPidFile(path.join(dataDir, "tunnel", "tailscale.pid"), ["tailscale", "tailscaled"]),
  ].some(Boolean);

  if (stopped) await new Promise((resolve) => setTimeout(resolve, 250));
}

// Resolve npx/9router binary to relaunch after update (cross-platform)
function resolveRelaunchCommand() {
  const isWin = process.platform === "win32";
  // Prefer `npx 9router` — works regardless of global bin path changes after npm i -g
  const npx = isWin ? "npx.cmd" : "npx";
  return { cmd: npx, args: [UPDATER_CONFIG.npmPackageName] };
}

// Spawn detached headless updater (Node process) then exit current server.
// Resolve only after `spawn` succeeds so the API never reports a successful
// update while shutting down the only running app instance on a bad launch.
export function spawnUpdaterAndExit(packageName = UPDATER_CONFIG.npmPackageName) {
  const updaterPath = ensureRuntimeUpdater(resolveBundledUpdaterPath());
  const isTray = process.env.TRAY_MODE === "1";
  const relaunch = resolveRelaunchCommand();
  // Relaunch matching original env: tray stays tray, foreground stays foreground
  const relaunchArgs = isTray
    ? [...relaunch.args, "--tray", "--skip-update"]
    : [...relaunch.args, "--skip-update"];

  return new Promise((resolve) => {
    let child;
    let settled = false;
    const finish = (started) => {
      if (settled) return;
      settled = true;
      resolve(started);
    };

    try {
      child = spawn(process.execPath, [updaterPath], {
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
      });
    } catch (error) {
      console.error(`[Updater] failed to start: ${error.message}`);
      finish(false);
      return;
    }

    child.once("error", (error) => {
      console.error(`[Updater] failed to start: ${error.message}`);
      finish(false);
    });
    child.once("spawn", () => {
      child.unref();
      setTimeout(() => process.exit(0), UPDATER_CONFIG.exitDelayMs);
      finish(true);
    });
  });
}
