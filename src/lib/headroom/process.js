import fs from "fs";
import path from "path";
import { execFileSync, spawn } from "child_process";
import { DATA_DIR } from "@/lib/dataDir.js";
import { findHeadroomBinary, findPython310, HEADROOM_COMPRESSION_EXTRAS, EXTRA_MARKERS, getInstalledHeadroomExtras } from "./detect.js";

const HEADROOM_DIR = path.join(DATA_DIR, "headroom");
const PID_FILE = path.join(HEADROOM_DIR, "proxy.pid");
const LOG_FILE = path.join(HEADROOM_DIR, "proxy.log");
const INSTALL_LOG_FILE = path.join(HEADROOM_DIR, "install.log");
const DEFAULT_PORT = 8787;
const STARTUP_TIMEOUT_MS = 8000;
const PROCESS_PROBE_TIMEOUT_MS = 1500;

// Two browser requests can arrive before the first detached proxy has written
// its PID record. Queue lifecycle mutations so start/stop/restart cannot
// orphan each other or overwrite each other's PID record.
let lifecycleTail = Promise.resolve();
let queuedOperation = null;

function ensureDir() {
  if (!fs.existsSync(HEADROOM_DIR)) fs.mkdirSync(HEADROOM_DIR, { recursive: true });
}

function readPidRecord() {
  try {
    if (!fs.existsSync(PID_FILE)) return null;
    const raw = fs.readFileSync(PID_FILE, "utf8").trim();
    if (!raw) return null;

    // Older releases stored only a PID. Preserve compatibility, but do not
    // regard it as proof of ownership because Windows and Unix reuse PIDs.
    if (/^\d+$/.test(raw)) return { pid: parseInt(raw, 10), binary: null };

    const record = JSON.parse(raw);
    if (!Number.isInteger(record?.pid) || record.pid <= 0) return null;
    return {
      pid: record.pid,
      binary: typeof record.binary === "string" ? record.binary : null,
      port: Number.isInteger(record.port) ? record.port : null,
      startedAt: typeof record.startedAt === "string" ? record.startedAt : null,
    };
  } catch { /* ignore */ }
  return null;
}

function writePid(pid, binary, port) {
  ensureDir();
  fs.writeFileSync(PID_FILE, JSON.stringify({
    pid,
    binary: path.basename(binary).toLowerCase(),
    port,
    startedAt: new Date().toISOString(),
  }));
}

function clearPid(expectedPid = null) {
  try {
    if (!fs.existsSync(PID_FILE)) return;
    if (expectedPid !== null) {
      const record = readPidRecord();
      if (!record || record.pid !== expectedPid) return;
    }
    fs.unlinkSync(PID_FILE);
  } catch { /* ignore */ }
}

// process.kill throws if pid is dead — use this to probe.
export function isPidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function getProcessImageName(pid) {
  try {
    if (process.platform === "win32") {
      const output = execFileSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: PROCESS_PROBE_TIMEOUT_MS,
      });
      return output.match(/^"([^"]+)"/m)?.[1]?.trim().toLowerCase() || null;
    }

    const output = execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: PROCESS_PROBE_TIMEOUT_MS,
    }).trim();
    return output ? path.basename(output).toLowerCase() : null;
  } catch {
    return null;
  }
}

function isHeadroomPidOwned(record) {
  if (!record || !isPidAlive(record.pid)) return false;
  const imageName = getProcessImageName(record.pid);
  if (!imageName) return false;

  // Records written by this version must match the exact launched executable.
  // A legacy bare PID gets the conservative fallback: only an unambiguous
  // headroom image can be managed, never an arbitrary recycled PID.
  if (record.binary) return imageName === record.binary.toLowerCase();
  return /^headroom(?:\.exe)?$/i.test(imageName);
}

function getManagedRecord() {
  const record = readPidRecord();
  if (!record) return null;
  if (isHeadroomPidOwned(record)) return record;
  clearPid(record.pid);
  return null;
}

export function getManagedPid() {
  return getManagedRecord()?.pid || null;
}

function closeFdOnce(fd, state) {
  if (state.closed) return;
  state.closed = true;
  try { fs.closeSync(fd); } catch { /* already closed or invalid */ }
}

function waitForPidExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const poll = () => {
      if (!isPidAlive(pid)) return resolve(true);
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(poll, 100);
    };
    poll();
  });
}

function queueLifecycle(kind, operation) {
  if (queuedOperation?.kind === kind) return queuedOperation.promise;

  // Keep the queue live after a rejected operation while still returning the
  // original rejection to the request that initiated it.
  const pending = lifecycleTail.then(operation);
  lifecycleTail = pending.catch(() => {});
  queuedOperation = { kind, promise: pending };
  const clear = () => {
    if (queuedOperation?.promise === pending) queuedOperation = null;
  };
  pending.then(clear, clear);
  return pending;
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

async function startHeadroomProxyImpl({ port = DEFAULT_PORT, codeAware = false, kompress = true } = {}) {
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
  // spawn stdio requires fd numbers, not WriteStream objects.
  const outFd = fs.openSync(LOG_FILE, "a");
  const fdState = { closed: false };

  const args = ["proxy", "--port", String(safePort), ...extrasProxyArgs({ codeAware, kompress })];
  let child;
  try {
    child = spawn(binary, args, {
      stdio: ["ignore", outFd, outFd],
      detached: true,
      windowsHide: true,
      env: { ...process.env },
    });
  } catch (cause) {
    closeFdOnce(outFd, fdState);
    const err = new Error(`Failed to spawn headroom proxy: ${cause.message}`);
    err.code = "SPAWN_FAILED";
    throw err;
  }

  if (!child.pid) {
    // An asynchronous spawn error would otherwise be an unhandled EventEmitter
    // error after this function has returned.
    child.once("error", () => closeFdOnce(outFd, fdState));
    closeFdOnce(outFd, fdState);
    const err = new Error("Failed to spawn headroom proxy");
    err.code = "SPAWN_FAILED";
    throw err;
  }

  child.unref();
  writePid(child.pid, binary, safePort);

  // `spawn()` reports missing/broken executables asynchronously. Without an
  // error listener Node throws an uncaught EventEmitter error and takes the
  // router down. Reject the pending startup immediately instead.
  let startupReject = null;
  let startupTimer = null;
  let startupSettled = false;
  child.once("error", (cause) => {
    clearPid(child.pid);
    closeFdOnce(outFd, fdState);
    if (startupReject && !startupSettled) {
      startupSettled = true;
      if (startupTimer) clearTimeout(startupTimer);
      const err = new Error(`Failed to start headroom proxy: ${cause.message}`);
      err.code = "SPAWN_FAILED";
      startupReject(err);
    }
  });

  // Wait until the process either stays alive briefly (success) or exits fast (failure).
  await new Promise((resolve, reject) => {
    startupReject = reject;
    startupTimer = setTimeout(() => {
      startupSettled = true;
      if (isPidAlive(child.pid)) resolve();
      else reject(new Error("headroom proxy exited during startup — see proxy.log"));
    }, STARTUP_TIMEOUT_MS);

    child.once("exit", (code) => {
      clearTimeout(startupTimer);
      startupSettled = true;
      clearPid(child.pid);
      closeFdOnce(outFd, fdState);
      const e = new Error(`headroom proxy exited early (code=${code}) — see proxy.log`);
      e.code = "EARLY_EXIT";
      reject(e);
    });
  });

  // Close parent's copy of the fd; child retains its own after unref.
  closeFdOnce(outFd, fdState);

  return { pid: child.pid, alreadyRunning: false };
}

export function startHeadroomProxy(options = {}) {
  return queueLifecycle("start", () => startHeadroomProxyImpl(options));
}

async function stopHeadroomProxyImpl() {
  const record = getManagedRecord();
  if (!record) return { stopped: false, reason: "not_running" };
  const { pid } = record;

  try {
    process.kill(pid, "SIGTERM");
  } catch (cause) {
    // If the PID has already gone away or been reused, retire our record. If
    // it is still our process, preserve the record so a later Stop can retry.
    if (!isHeadroomPidOwned(record)) clearPid(pid);
    const err = new Error(`Failed to stop headroom proxy: ${cause.message}`);
    err.code = "STOP_FAILED";
    throw err;
  }

  if (!(await waitForPidExit(pid, 2000))) {
    // A PID may be reused while we wait. Re-check executable ownership before
    // escalation so SIGKILL can never target an unrelated process.
    if (!isHeadroomPidOwned(record)) {
      clearPid(pid);
      return { stopped: true, pid };
    }
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
    if (!(await waitForPidExit(pid, 1000)) && isHeadroomPidOwned(record)) {
      const err = new Error("Headroom proxy did not exit after a forced stop");
      err.code = "STOP_TIMEOUT";
      throw err;
    }
  }

  clearPid(pid);
  return { stopped: true, pid };
}

export function stopHeadroomProxy() {
  return queueLifecycle("stop", stopHeadroomProxyImpl);
}

async function restartHeadroomProxyImpl(opts = {}) {
  await stopHeadroomProxyImpl();
  return startHeadroomProxyImpl(opts);
}

// Stop the managed proxy (if any), then start it with the requested flags.
// Queueing makes repeated Restart clicks resolve to one controlled operation.
export function restartHeadroomProxy(opts = {}) {
  return queueLifecycle("restart", () => restartHeadroomProxyImpl(opts));
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
  // Floor the spec at the installed version. Without it, an extra whose deps are
  // unsatisfiable on this platform (e.g. `ml` needs torch, which has no
  // musl/Python-3.14 wheel) makes pip backtrack through older releases hunting
  // for one where the extra simply doesn't exist — then DOWNGRADE to it. Seen in
  // the wild: 0.5.4 -> 0.2.2, whose half-finished uninstall removed the
  // `headroom` console script and left the CLI undetectable. With a floor pip
  // reports the real conflict instead.
  const installedVersion = getInstalledHeadroomExtras(py)?.version || null;
  const spec = installedVersion
    ? `headroom-ai[${extrasList}]>=${installedVersion}`
    : `headroom-ai[${extrasList}]`;
  const args = ["-m", "pip", "install", "--upgrade", spec];

  ensureDir();
  // Truncate ("w") so the log reflects only the current install for live progress.
  const outFd = fs.openSync(INSTALL_LOG_FILE, "w");
  const child = spawn(py, args, {
    stdio: ["ignore", outFd, outFd],
    windowsHide: true,
    env: { ...process.env },
  });

  return new Promise((resolve, reject) => {
    child.once("error", (e) => { fs.closeSync(outFd); reject(e); });
    child.once("exit", (code) => {
      fs.closeSync(outFd);
      if (code === 0) {
        const status = getInstalledHeadroomExtras(py);
        resolve({ success: true, code, spec, extras: requested, ...status });
      } else {
        // Turn pip's resolver wall-of-text into something actionable: the common
        // failure is an extra that cannot be built for this interpreter/libc.
        const log = getInstallLogTail(400);
        const unsatisfiable = /No matching distribution found|does not provide the extra|ResolutionImpossible/i.test(log);
        const err = new Error(
          unsatisfiable
            ? `Could not install headroom extras [${requested.join(", ")}] — a dependency has no wheel for this interpreter/platform (the "ml" extra needs torch, which publishes nothing for musl/Alpine). Existing install left as-is. See headroom/install.log.`
            : `pip install exited with code=${code} — see headroom/install.log`
        );
        err.code = unsatisfiable ? "EXTRA_UNAVAILABLE" : "INSTALL_FAILED";
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
  const child = spawn(py, args, {
    stdio: ["ignore", outFd, outFd],
    windowsHide: true,
    env: { ...process.env },
  });

  return new Promise((resolve, reject) => {
    child.once("error", (e) => { fs.closeSync(outFd); reject(e); });
    child.once("exit", (code) => {
      fs.closeSync(outFd);
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
