// Fast previous-instance detection for the launcher.
//
// The launcher records its own PID and its server's PID in <dataDir>/launcher.pid.
// The next launch stops exactly those processes instead of scanning every process
// on the machine (a PowerShell WMI query costs ~0.5s per call on Windows), and only
// falls back to the full scan when the port is still occupied.

const { execFileSync } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

const PID_FILE_NAME = "launcher.pid";
const PORT_PROBE_TIMEOUT_MS = 500;
const DEFAULT_WAIT_TIMEOUT_MS = 3000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const EXE_LOOKUP_TIMEOUT_MS = 2000;

function getPidFilePath(dataDir) {
  return path.join(dataDir, PID_FILE_NAME);
}

function toPid(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * @param {string} file
 * @param {{ cliPid: number, serverPid: number|null, port: number, exe: string }} record
 */
function writePidRecord(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record));
  fs.renameSync(tmp, file);
}

/** @returns {{ cliPid: number, serverPid: number|null, port: number|null, exe: string } | null} */
function readPidRecord(file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const cliPid = toPid(parsed.cliPid);
  if (!cliPid || typeof parsed.exe !== "string" || !parsed.exe) return null;
  return {
    cliPid,
    serverPid: toPid(parsed.serverPid),
    port: Number.isSafeInteger(parsed.port) ? parsed.port : null,
    exe: parsed.exe,
  };
}

function removePidRecordIfOwner(file, ownerPid) {
  const record = readPidRecord(file);
  if (!record || record.cliPid !== ownerPid) return;
  try { fs.unlinkSync(file); } catch { /* already removed */ }
}

function isPidAlive(pid, { kill = process.kill.bind(process) } = {}) {
  if (!toPid(pid)) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (err) {
    return err && err.code === "EPERM";
  }
}

function normalizeExeName(name) {
  return String(name || "").trim().toLowerCase().replace(/\.exe$/, "");
}

function lookupExeName(pid) {
  if (process.platform === "win32") {
    const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: EXE_LOOKUP_TIMEOUT_MS,
    });
    const match = out.match(/^"([^"]+)","(\d+)"/m);
    return match && Number(match[2]) === pid ? match[1] : "";
  }
  // /proc/<pid>/comm is rewritten by process.title (Next sets "next-server (v…)"),
  // so resolve the real executable instead.
  try {
    return fs.readlinkSync(`/proc/${pid}/exe`);
  } catch {
    return execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
      timeout: EXE_LOOKUP_TIMEOUT_MS,
    });
  }
}

// Guards against PID reuse: a stale record must not kill an unrelated program.
function processMatchesExe(pid, exe) {
  const expected = normalizeExeName(exe);
  if (!expected || !toPid(pid)) return false;
  try {
    return normalizeExeName(path.basename(lookupExeName(pid))) === expected;
  } catch {
    return false;
  }
}

function defaultKillPid(pid) {
  if (process.platform === "win32") {
    execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)], {
      stdio: "ignore",
      windowsHide: true,
      timeout: EXE_LOOKUP_TIMEOUT_MS,
    });
  } else {
    process.kill(pid, "SIGKILL");
  }
}

/**
 * Stops the processes named in a launcher record. Returns the PIDs it killed.
 * Server first so the port is released even if the CLI kill fails.
 */
function stopRecordedInstance(record, {
  selfPid = process.pid,
  isAlive = isPidAlive,
  matchesExe = processMatchesExe,
  killPid = defaultKillPid,
} = {}) {
  if (!record) return [];
  const candidates = [record.serverPid, record.cliPid].filter((pid) => toPid(pid) && pid !== selfPid);
  const killed = [];
  for (const pid of candidates) {
    if (!isAlive(pid) || !matchesExe(pid, record.exe)) continue;
    try {
      killPid(pid);
      killed.push(pid);
    } catch { /* already gone or not permitted — the port check decides what's next */ }
  }
  return killed;
}

function isPortInUse(port, host = "127.0.0.1", timeoutMs = PORT_PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function pollUntil(check, { timeoutMs = DEFAULT_WAIT_TIMEOUT_MS, intervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function waitForPortFree(port, opts = {}) {
  return pollUntil(async () => !(await isPortInUse(port)), opts);
}

function waitForPidsExit(pids, { isAlive = isPidAlive, ...opts } = {}) {
  return pollUntil(() => pids.every((pid) => !isAlive(pid)), opts);
}

module.exports = {
  getPidFilePath,
  writePidRecord,
  readPidRecord,
  removePidRecordIfOwner,
  isPidAlive,
  processMatchesExe,
  stopRecordedInstance,
  isPortInUse,
  waitForPortFree,
  waitForPidsExit,
};
