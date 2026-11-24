import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { DATA_DIR } from "@/lib/dataDir.js";
import { DEFAULT_HEADROOM_URL, probeProxyRunning, findHeadroomBinary, findPython310, HEADROOM_COMPRESSION_EXTRAS, EXTRA_MARKERS, getInstalledHeadroomExtras } from "./detect.js";

import { validateHeadroomUrl, isLoopbackHeadroomUrl } from "./transport.js";

const HEADROOM_DIR = path.join(DATA_DIR, "headroom");
const LOG_FILE = path.join(HEADROOM_DIR, "proxy.log");
const INSTALL_LOG_FILE = path.join(HEADROOM_DIR, "install.log");
const STARTUP_TIMEOUT_MS = 8000;

function ensureDir() {
  if (!fs.existsSync(HEADROOM_DIR)) fs.mkdirSync(HEADROOM_DIR, { recursive: true });
}

// Route chunks share one owner. A detached proxy surviving a gateway restart
// becomes external: a PID file alone cannot prove who owns a recycled PID.
const owner = globalThis.__9routerHeadroom ??= { child: null, origin: null, queue: Promise.resolve() };

function serialize(work) {
  const result = owner.queue.then(work);
  owner.queue = result.catch(() => {});
  return result;
}

function ownerAt(url) {
  return owner.origin === validateHeadroomUrl(url).origin ? owner.child : null;
}

export function getManagedPid(url) {
  return ownerAt(url)?.pid || null;
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

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

async function start({ url = DEFAULT_HEADROOM_URL, codeAware = false, kompress = true } = {}) {
  const base = validateHeadroomUrl(url);
  const healthy = await probeProxyRunning(url);
  const pid = getManagedPid(url);
  if (healthy) return { state: pid ? "running" : "external", pid, alreadyRunning: true };
  if (!isLoopbackHeadroomUrl(url)) throw failure("EXTERNAL_PROXY", "External Headroom proxy unreachable");
  if (owner.child) throw failure("UNREACHABLE", "Managed Headroom proxy exists; check its URL and log");
  const binary = findHeadroomBinary();
  if (!binary) throw failure("NOT_INSTALLED", "Headroom CLI not installed");

  ensureDir();
  const outFd = fs.openSync(LOG_FILE, "a");
  const port = base.port || (base.protocol === "https:" ? "443" : "80");
  let child;
  try {
    child = spawn(binary, ["proxy", "--port", port, ...extrasProxyArgs({ codeAware, kompress })], {
      stdio: ["ignore", outFd, outFd], detached: true, windowsHide: true,
    });
  } finally {
    fs.closeSync(outFd);
  }
  owner.child = child;
  owner.origin = base.origin;
  const exited = new Promise((_, reject) => {
    const release = (error) => {
      if (owner.child === child) {
        owner.child = null;
        owner.origin = null;
      }
      reject(error);
    };
    child.once("error", () => release(failure("SPAWN_FAILED", "Failed to spawn Headroom proxy")));
    child.once("exit", (code) => release(failure("EARLY_EXIT", `Headroom proxy exited early (code=${code}) - see proxy.log`)));
  });
  child.unref();
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  do {
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 200))]);
    if (await Promise.race([exited, probeProxyRunning(url)])) {
      return { state: "running", pid: child.pid, alreadyRunning: false };
    }
  } while (Date.now() < deadline);
  throw failure("UNREACHABLE", "Managed Headroom proxy did not become healthy - see proxy.log");
}

async function stop(url) {
  const child = ownerAt(url);
  if (!child) return { stopped: false, reason: "not_managed" };
  // Use the retained ChildProcess handle only. Never signal a PID read from disk.
  const exited = new Promise(resolve => child.once("exit", () => resolve(true)));
  child.kill("SIGTERM");
  if (!await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000, false))])) {
    if (owner.child === child) child.kill("SIGKILL");
    if (!await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 1000, false))])) {
      throw failure("STOP_FAILED", "Headroom proxy did not stop");
    }
  }
  return { stopped: true, pid: child.pid };
}

export function startHeadroomProxy(options) {
  return serialize(() => start(options));
}
export function stopHeadroomProxy(url = DEFAULT_HEADROOM_URL) {
  return serialize(() => stop(url));
}
export function restartHeadroomProxy(options) {
  return serialize(async () => {
    await stop(options.url);
    return start(options);
  });
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
