import fs from "fs";
import path from "path";
import { spawn, execSync } from "child_process";
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

function clearPid() {
  try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

// process.kill throws if pid is dead — use this to probe.
export function isPidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function parseCmdlineArgs(cmdline) {
  if (!cmdline || typeof cmdline !== "string") return [];
  if (cmdline.includes("\0")) return cmdline.split("\0").filter(Boolean);
  const args = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(cmdline)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  return args;
}

function isHeadroomCmdline(cmdline, port) {
  const args = parseCmdlineArgs(cmdline);
  if (!args.length) return false;

  let proxyIndex = -1;
  const first = path.basename(args[0].replace(/\\/g, "/")).toLowerCase();
  if (first === "headroom" || first === "headroom.exe" || first === "headroom-ai") {
    if (args[1]?.toLowerCase() === "proxy") proxyIndex = 1;
  } else if (/^python(?:\d+(?:\.\d+)?)?(?:\.exe)?$/i.test(first)) {
    const second = path.basename((args[1] || "").replace(/\\/g, "/")).toLowerCase();
    if (second === "headroom" || second === "headroom.exe" || second === "headroom-ai") {
      if (args[2]?.toLowerCase() === "proxy") proxyIndex = 2;
    } else if (args[1] === "-m" && (args[2]?.toLowerCase() === "headroom" || args[2]?.toLowerCase() === "headroom-ai")) {
      if (args[3]?.toLowerCase() === "proxy") proxyIndex = 3;
    }
  }

  if (proxyIndex === -1) return false;

  if (port != null) {
    let cmdPort = DEFAULT_PORT;
    for (let i = proxyIndex; i < args.length; i++) {
      const eqMatch = args[i].match(/^(?:--port|-p)=(\d+)$/i);
      if (eqMatch) {
        cmdPort = parseInt(eqMatch[1], 10);
        break;
      }
      if ((args[i] === "--port" || args[i] === "-p") && args[i + 1]) {
        cmdPort = parseInt(args[i + 1], 10);
        break;
      }
    }
    return cmdPort === Number(port);
  }
  return true;
}

export function isHeadroomProcess(pid, port) {
  if (!isPidAlive(pid)) return false;
  try {
    if (process.platform === "linux" && fs.existsSync(`/proc/${pid}/cmdline`)) {
      const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      return isHeadroomCmdline(cmdline, port);
    }
    if (process.platform === "win32") {
      try {
        const out = execSync(`wmic process where processid=${pid} get commandline`, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).toString();
        const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const cmdline = lines.find((l) => !/^commandline$/i.test(l)) || "";
        if (isHeadroomCmdline(cmdline, port)) return true;
      } catch { /* try PowerShell fallback */ }
      try {
        const out = execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId = ${pid}\\").CommandLine"`, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).toString().trim();
        if (isHeadroomCmdline(out, port)) return true;
      } catch { /* ignore */ }
      return false;
    }
    const out = execSync(`ps -p ${pid} -o command=`, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).toString();
    return isHeadroomCmdline(out, port);
  } catch {
    return false;
  }
}

function findPidOnPort(port) {
  const safePort = Number(port);
  if (!Number.isInteger(safePort) || safePort <= 0 || safePort >= 65536) return null;
  try {
    let pid = null;
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano -p tcp | findstr :${safePort}`, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).toString();
      for (const line of out.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5 && parts[1].endsWith(`:${safePort}`) && parts[3] === "LISTENING") {
          const parsed = parseInt(parts[4], 10);
          if (Number.isFinite(parsed) && parsed > 0) { pid = parsed; break; }
        }
      }
    } else {
      const out = execSync(`lsof -ti tcp:${safePort} -sTCP:LISTEN`, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).toString().trim();
      const parsed = parseInt(out.split(/\s+/)[0], 10);
      if (Number.isFinite(parsed) && parsed > 0) pid = parsed;
    }
    if (pid && isHeadroomProcess(pid, safePort)) return pid;
  } catch { /* ignore */ }
  return null;
}

export function getManagedPid(port = DEFAULT_PORT) {
  const safePort = Number(port);
  if (!Number.isInteger(safePort) || safePort <= 0 || safePort >= 65536) return null;
  const portPid = findPidOnPort(safePort);
  if (portPid) return portPid;
  const pid = readPid();
  if (pid && isPidAlive(pid) && isHeadroomProcess(pid, safePort)) {
    return pid;
  }
  return null;
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

  const existing = getManagedPid(safePort);
  if (existing) return { pid: existing, alreadyRunning: true };

  ensureDir();
  // spawn stdio requires fd numbers, not WriteStream objects.
  const outFd = fs.openSync(LOG_FILE, "a");

  const args = ["proxy", "--port", String(safePort), ...extrasProxyArgs({ codeAware, kompress })];
  const child = spawn(binary, args, {
    stdio: ["ignore", outFd, outFd],
    detached: true,
    windowsHide: true,
    env: {
      ...process.env,
      DO_NOT_TRACK: "1",
      HEADROOM_TELEMETRY: "off",
      HEADROOM_BEACON: "off",
    },
  });

  if (!child.pid) {
    fs.closeSync(outFd);
    const err = new Error("Failed to spawn headroom proxy");
    err.code = "SPAWN_FAILED";
    throw err;
  }

  child.unref();
  writePid(child.pid);

  // Wait until the process either stays alive briefly (success) or exits fast (failure).
  await new Promise((resolve, reject) => {
    const startupTimer = setTimeout(() => {
      if (isPidAlive(child.pid)) resolve();
      else reject(new Error("headroom proxy exited during startup — see proxy.log"));
    }, STARTUP_TIMEOUT_MS);

    child.once("exit", (code) => {
      clearTimeout(startupTimer);
      clearPid();
      fs.closeSync(outFd);
      const e = new Error(`headroom proxy exited early (code=${code}) — see proxy.log`);
      e.code = "EARLY_EXIT";
      reject(e);
    });
  });

  // Close parent's copy of the fd; child retains its own after unref.
  fs.closeSync(outFd);

  return { pid: child.pid, alreadyRunning: false };
}

export function stopHeadroomProxy({ port = DEFAULT_PORT } = {}) {
  const safePort = Number(port) > 0 && Number(port) < 65536 ? Number(port) : DEFAULT_PORT;
  const pid = getManagedPid(safePort);
  if (!pid) return { stopped: false, reason: "not_running" };
  try {
    process.kill(pid, "SIGTERM");
    // Give it a moment, then force if still alive.
    setTimeout(() => {
      if (isPidAlive(pid)) {
        try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
      }
    }, 2000);
    clearPid();
    return { stopped: true, pid };
  } catch (e) {
    clearPid();
    const err = new Error(`Failed to stop headroom proxy: ${e.message}`);
    err.code = "STOP_FAILED";
    throw err;
  }
}

// Stop the managed proxy (if any), wait for the pid to die, then start again
// with the given flags. Used when toggling active extras that require a restart.
export async function restartHeadroomProxy({ port = DEFAULT_PORT, ...opts } = {}) {
  const safePort = Number(port) > 0 && Number(port) < 65536 ? Number(port) : DEFAULT_PORT;
  const pid = getManagedPid(safePort);
  if (pid) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    // Wait up to ~3s for graceful exit, force-kill if still alive.
    for (let i = 0; i < 30 && isPidAlive(pid); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (isPidAlive(pid)) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    clearPid();
  }
  return startHeadroomProxy({ port: safePort, ...opts });
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
