import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { DATA_DIR } from "@/lib/dataDir.js";
import { findHeadroomBinary, findPython310, HEADROOM_COMPRESSION_EXTRAS, EXTRA_MARKERS, getInstalledHeadroomExtras } from "./detect.js";

const HEADROOM_DIR = path.join(DATA_DIR, "headroom");
const PID_FILE = path.join(HEADROOM_DIR, "proxy.pid");
const LOG_FILE = path.join(HEADROOM_DIR, "proxy.log");
const INSTALL_LOG_FILE = path.join(HEADROOM_DIR, "install.log");
const DEFAULT_PORT = 8787;
const STARTUP_TIMEOUT_MS = 8000;

function ensureDir() {
  if (!fs.existsSync(HEADROOM_DIR)) fs.mkdirSync(HEADROOM_DIR, { recursive: true });
}

function readPid() {
  try {
    if (fs.existsSync(PID_FILE)) return parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
  } catch { /* ignore */ }
  return null;
}

function writePid(pid) {
  ensureDir();
  fs.writeFileSync(PID_FILE, String(pid));
}

// Clear the PID file only if it still names `expectedPid`. A concurrent start
// may have rewritten it for a newer process — never delete a newer owner.
function clearPid(expectedPid = null) {
  try {
    if (!fs.existsSync(PID_FILE)) return;
    if (expectedPid != null) {
      const current = parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
      if (current !== expectedPid) return;
    }
    fs.unlinkSync(PID_FILE);
  } catch { /* ignore */ }
}

// Wait for `pid` to die. Bounded TERM → poll → KILL → verify. Resolves true
// only when death is observed; false means it survived everything.
async function awaitPidDeath(pid, { termGraceMs = 2000, killWaitMs = 1000, pollMs = 50 } = {}) {
  try { process.kill(pid, "SIGTERM"); } catch { return isPidAlive(pid) ? false : true; }
  const deadline = Date.now() + termGraceMs;
  while (Date.now() < deadline && isPidAlive(pid)) {
    await new Promise((r) => setTimeout(r, pollMs));
  }
  if (!isPidAlive(pid)) return true;
  try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  const killDeadline = Date.now() + killWaitMs;
  while (Date.now() < killDeadline && isPidAlive(pid)) {
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return !isPidAlive(pid);
}

// process.kill throws if pid is dead — use this to probe.
export function isPidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function getManagedPid() {
  const pid = readPid();
  return pid && isPidAlive(pid) ? pid : null;
}

// Build proxy CLI flags for the active compression extras. `[code]` (AST
// compression) is off by default in headroom → pass --code-aware to turn it on;
// `[ml]` (Kompress) is on by default → pass --disable-kompress to turn it off.
function extrasProxyArgs({ codeAware, kompress } = {}) {
  const args = [];
  if (codeAware) args.push("--code-aware");
  if (kompress === false) args.push("--disable-kompress");
  return args;
}

export async function startHeadroomProxy({ port = DEFAULT_PORT, codeAware = false, kompress = true } = {}) {
  const safePort = Number(port) > 0 && Number(port) < 65536 ? Number(port) : DEFAULT_PORT;
  const binary = findHeadroomBinary();
  if (!binary) {
    const err = new Error("Headroom CLI not installed");
    err.code = "NOT_INSTALLED";
    throw err;
  }

  const existing = getManagedPid();
  if (existing) return { pid: existing, alreadyRunning: true };

  ensureDir();
  const outFd = fs.openSync(LOG_FILE, "a");
  let fdClosed = false;
  let settled = false;
  const closeFdOnce = () => { if (!fdClosed) { try { fs.closeSync(outFd); } catch {} fdClosed = true; } };
  const settleOnce = (res, rej, kind) => {
    if (settled) return false;
    settled = true;
    if (kind === "resolve") res();
    else rej(kind);
    return true;
  };

  const args = ["proxy", "--port", String(safePort), ...extrasProxyArgs({ codeAware, kompress })];
  let child;
  try {
    child = spawn(binary, args, {
      stdio: ["ignore", outFd, outFd],
      detached: true,
      windowsHide: true,
      env: { ...process.env },
    });
  } catch (error) {
    // spawn can throw synchronously (e.g. invalid binary) — never leak the log fd.
    closeFdOnce();
    const err = new Error(error?.message || "Failed to spawn headroom proxy");
    err.code = "SPAWN_FAILED";
    throw err;
  }

  if (!child.pid) {
    closeFdOnce();
    const err = new Error("Failed to spawn headroom proxy");
    err.code = "SPAWN_FAILED";
    throw err;
  }

  child.unref();
  writePid(child.pid);
  const spawnedPid = child.pid;

  const pending = await new Promise((resolve, reject) => {
    let startupTimer;
    const failEarlyExit = (code) => {
      clearTimeout(startupTimer);
      const e = new Error(`headroom proxy exited early (code=${code}) — see proxy.log`);
      e.code = "EARLY_EXIT";
      if (settleOnce(resolve, reject, e)) { closeFdOnce(); clearPid(spawnedPid); }
    };
    startupTimer = setTimeout(() => {
      if (isPidAlive(spawnedPid)) {
        // Success: drop the early-exit handler so a late crash fires only the
        // late handler registered after this promise settles.
        child.removeListener("exit", failEarlyExit);
        if (settleOnce(resolve, reject, "resolve")) closeFdOnce();
      } else {
        const err = new Error("headroom proxy exited during startup — see proxy.log");
        if (settleOnce(resolve, reject, err)) closeFdOnce();
      }
    }, STARTUP_TIMEOUT_MS);

    child.once("error", (error) => {
      clearTimeout(startupTimer);
      const e = new Error(error?.message || "Failed to spawn headroom proxy");
      e.code = error?.code || "SPAWN_FAILED";
      if (settleOnce(resolve, reject, e)) closeFdOnce();
    });

    child.once("exit", failEarlyExit);
  }).then(
    () => ({ success: true }),
    (err) => ({ success: false, err })
  );
  if (!pending.success) throw pending.err;

  // Late exit AFTER successful startup: only clear the PID file if it still
  // names THIS spawn's pid (a newer start owns it otherwise). Never throws.
  child.once("exit", () => { try { if (!isPidAlive(spawnedPid)) clearPid(spawnedPid); } catch {} });

  return { pid: spawnedPid, alreadyRunning: false };
}

export async function stopHeadroomProxy() {
  const pid = getManagedPid();
  if (!pid) return { stopped: false, reason: "not_running" };
  const ok = await awaitPidDeath(pid, { termGraceMs: 2000, killWaitMs: 800, pollMs: 100 });
  if (!ok) {
    const err = new Error(`Failed to stop headroom proxy (pid ${pid} still alive) — see proxy.log`);
    err.code = "STOP_FAILED";
    throw err;
  }
  clearPid(pid);
  return { stopped: true, pid };
}

// Stop the managed proxy (if any), wait for the pid to die, then start again
// with the given flags. Used when toggling active extras that require a restart.
export async function restartHeadroomProxy(opts = {}) {
  const pid = getManagedPid();
  if (pid) {
    const ok = await awaitPidDeath(pid, { termGraceMs: 3000, killWaitMs: 300, pollMs: 100 });
    if (!ok) {
      const err = new Error(`restart failed: headroom proxy (pid ${pid}) did not exit`);
      err.code = "RESTART_FAILED";
      throw err;
    }
    clearPid(pid);
  }
  return startHeadroomProxy(opts);
}

export function getHeadroomLogTail(maxLines = 200) {
  try {
    if (!fs.existsSync(LOG_FILE)) return "";
    const content = fs.readFileSync(LOG_FILE, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch { return ""; }
}

// Install (or upgrade) headroom-ai with the requested compression extras.
// `extras` is a whitelist from HEADROOM_COMPRESSION_EXTRAS — anything else
// is rejected to keep the install surface predictable. Always installs the
// `proxy` base + whatever extras the user picked, regardless of what is
// already present.
export async function installHeadroomExtras(extras = []) {
  const requested = Array.isArray(extras) ? extras.filter((e) => HEADROOM_COMPRESSION_EXTRAS.includes(e)) : [];
  const py = findPython310();
  if (!py) {
    const err = new Error("Python >= 3.10 not found");
    err.code = "NO_PYTHON";
    throw err;
  }
  if (!findHeadroomBinary()) {
    const err = new Error("headroom-ai not installed (run `pip install headroom-ai[proxy]` first)");
    err.code = "NOT_INSTALLED";
    throw err;
  }
  // pip install string is built from a closed set (HEADROOM_COMPRESSION_EXTRAS),
  // so it cannot be poisoned by caller input — the comma-list is a fixed
  // ['proxy', ...requested]. No shell interpolation.
  const extrasList = ["proxy", ...requested].join(",");
  const spec = `headroom-ai[${extrasList}]`;
  const args = ["-m", "pip", "install", "--upgrade", spec];

  ensureDir();
  // Truncate ("w") so the log reflects only the current install for live progress.
  const outFd = fs.openSync(INSTALL_LOG_FILE, "w");
  let child;
  try {
    child = spawn(py, args, {
      stdio: ["ignore", outFd, outFd],
      windowsHide: true,
      env: { ...process.env },
    });
  } catch (error) {
    try { fs.closeSync(outFd); } catch {}
    throw error;
  }

  return new Promise((resolve, reject) => {
    let fdClosed = false;
    let settled = false;
    const closeFdOnce = () => { if (!fdClosed) { try { fs.closeSync(outFd); } catch {} fdClosed = true; } };
    const settleOnce = (fn, arg) => { if (settled) return false; settled = true; closeFdOnce(); fn(arg); return true; };
    child.once("error", (e) => { settleOnce(reject, e); });
    child.once("exit", (code) => {
      if (!settleOnce(() => {}, null)) return;
      if (code === 0) {
        const status = getInstalledHeadroomExtras(py);
        resolve({ success: true, code, spec, extras: requested, ...status });
      } else {
        const err = new Error(`pip install exited with code=${code} — see headroom/install.log`);
        err.code = "INSTALL_FAILED";
        reject(err);
      }
    });
  });
}

// Uninstall the marker packages that back a single extra (e.g. `ml` → torch,
// huggingface-hub). `headroom-ai` base and the `proxy` extra are never removed.
export async function uninstallHeadroomExtras(extras = []) {
  const requested = Array.isArray(extras) ? extras.filter((e) => HEADROOM_COMPRESSION_EXTRAS.includes(e)) : [];
  const py = findPython310();
  if (!py) {
    const err = new Error("Python >= 3.10 not found");
    err.code = "NO_PYTHON";
    throw err;
  }
  const pkgs = [...new Set(requested.flatMap((e) => EXTRA_MARKERS[e] || []))];
  if (pkgs.length === 0) {
    const err = new Error("No valid extras to remove");
    err.code = "INVALID_EXTRAS";
    throw err;
  }
  const args = ["-m", "pip", "uninstall", "-y", ...pkgs];

  ensureDir();
  const outFd = fs.openSync(INSTALL_LOG_FILE, "w");
  let child;
  try {
    child = spawn(py, args, {
      stdio: ["ignore", outFd, outFd],
      windowsHide: true,
      env: { ...process.env },
    });
  } catch (error) {
    try { fs.closeSync(outFd); } catch {}
    throw error;
  }

  return new Promise((resolve, reject) => {
    let fdClosed = false;
    let settled = false;
    const closeFdOnce = () => { if (!fdClosed) { try { fs.closeSync(outFd); } catch {} fdClosed = true; } };
    const settleOnce = (fn, arg) => { if (settled) return false; settled = true; closeFdOnce(); fn(arg); return true; };
    child.once("error", (e) => { settleOnce(reject, e); });
    child.once("exit", (code) => {
      if (!settleOnce(() => {}, null)) return;
      if (code === 0) {
        const status = getInstalledHeadroomExtras(py);
        resolve({ success: true, code, removed: pkgs, extras: requested, ...status });
      } else {
        const err = new Error(`pip uninstall exited with code=${code} — see headroom/install.log`);
        err.code = "UNINSTALL_FAILED";
        reject(err);
      }
    });
  });
}

// Read the tail of the install/uninstall log for live progress in the UI.
export function getInstallLogTail(maxLines = 15) {
  try {
    if (!fs.existsSync(INSTALL_LOG_FILE)) return "";
    const lines = fs.readFileSync(INSTALL_LOG_FILE, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch { return ""; }
}
