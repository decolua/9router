"use strict";

/**
 * Locating 9router's own leftover processes — safely.
 *
 * Two rules the previous implementations broke:
 *
 * 1. A pid must come from the pid *column*. We used to scan `ps aux` line by line
 *    and take the second whitespace-separated token as the pid. `ps` wraps long
 *    command lines, and a wrapped continuation line still contains the strings we
 *    match on ("9router", "next-server", …), so the "pid" could be any number in
 *    the command text and `kill -9` then hit an unrelated process. That is how a
 *    supervisor which had merely started the CLI got killed.
 * 2. Never kill a process we descend from. The parent of a 9router process is
 *    whoever launched it — a supervisor, a shell, a service manager — never a
 *    stale copy of us. Killing it takes down the thing keeping us running.
 *
 * Every candidate is re-checked (alive, and still matching) right before the
 * kill, so a recycled pid cannot be hit either.
 */

const { execSync } = require("child_process");
const fs = require("fs");

const PS_TIMEOUT_MS = 5000;
const MAX_ANCESTORS = 32;

/** True when the executable is a node binary (so a shell that merely mentions node is not one). */
function looksLikeNode(executable) {
  const exe = String(executable || "").replace(/^"|"$/g, "").toLowerCase();
  return exe === "node" || exe === "node.exe" || /[\\/]node(\.exe)?$/.test(exe);
}

/** Command lines that mean "a process of ours". Matched against a verified command line. */
function isAppProcess(command) {
  const cmd = String(command || "");
  if (!cmd.trim()) return false;
  const lower = cmd.toLowerCase();
  if (lower.includes("next-server")) return true;
  if (lower.includes("cloudflared")) return true;
  if (lower.includes("tray_darwin") || lower.includes("tray_linux") || lower.includes("tray_windows")) return true;
  // A node process running the CLI or started from the package directory. The
  // executable itself has to be node: a shell or editor that merely mentions
  // these strings in its command line is not one of our processes.
  const [executable = ""] = cmd.trim().split(/\s+/);
  return looksLikeNode(executable)
    && lower.includes("9router")
    && (lower.includes("cli.js") || lower.includes("/9router") || lower.includes("\\9router"));
}

/**
 * `ps -eo pid=,command=` output → `[{ pid, command }]`.
 *
 * Only a line whose first field is a pid is a process. `ps` is asked for unlimited
 * width (`-ww`, wide COLUMNS) precisely so it cannot wrap and slip a continuation
 * line — which may well start with a number — into this table. `collectAppPids`
 * re-reads each candidate anyway, so a stray number can never become a kill.
 */
function parseProcessTable(stdout) {
  const rows = [];
  for (const line of String(stdout || "").split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.+?)\s*$/);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isInteger(pid) || pid <= 1) continue;
    rows.push({ pid, command: match[2] });
  }
  return rows;
}

/** PowerShell's Win32_Process table → `[{ pid, command }]`. */
function parseWindowsProcessTable(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  return entries
    .map(entry => ({ pid: Number(entry && entry.ProcessId), command: String((entry && entry.CommandLine) || "") }))
    .filter(entry => Number.isInteger(entry.pid) && entry.pid > 1 && entry.command.length > 0);
}

function readProcessTable() {
  if (process.platform === "win32") {
    const cmd = 'powershell -NonInteractive -WindowStyle Hidden -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"';
    return parseWindowsProcessTable(execSync(cmd, { encoding: "utf8", windowsHide: true, timeout: PS_TIMEOUT_MS }));
  }
  const output = execSync("ps -ww -eo pid=,command= 2>/dev/null", {
    encoding: "utf8",
    timeout: PS_TIMEOUT_MS,
    env: { ...process.env, COLUMNS: "10000" },
  });
  return parseProcessTable(output);
}

/** The command line a pid is running right now, or null when it is gone. */
function readCommand(pid) {
  if (process.platform === "linux") {
    try {
      const raw = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      return raw.replace(/\0/g, " ").trim() || null;
    } catch {
      return null;
    }
  }
  try {
    if (process.platform === "win32") {
      const cmd = `powershell -NonInteractive -WindowStyle Hidden -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`;
      const out = execSync(cmd, { encoding: "utf8", windowsHide: true, timeout: PS_TIMEOUT_MS }).trim();
      return out.length > 0 ? out : null;
    }
    const out = execSync(`ps -p ${pid} -o command= 2>/dev/null`, { encoding: "utf8", timeout: PS_TIMEOUT_MS }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

function parentOf(pid) {
  try {
    if (process.platform === "linux") {
      const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
      const match = status.match(/^PPid:\s+(\d+)/m);
      return match ? Number(match[1]) : null;
    }
    if (process.platform === "win32") {
      const cmd = `powershell -NonInteractive -WindowStyle Hidden -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ParentProcessId"`;
      const out = execSync(cmd, { encoding: "utf8", windowsHide: true, timeout: PS_TIMEOUT_MS }).trim();
      const parent = Number(out);
      return Number.isInteger(parent) && parent > 0 ? parent : null;
    }
    const out = execSync(`ps -o ppid= -p ${pid} 2>/dev/null`, { encoding: "utf8", timeout: PS_TIMEOUT_MS }).trim();
    const parent = Number(out);
    return Number.isInteger(parent) && parent > 0 ? parent : null;
  } catch {
    return null;
  }
}

/**
 * Our own pid plus every ancestor: the process that started us is not a stale
 * copy of us and must never be a kill target.
 */
function ownProcessChain(startPid = process.pid, parentLookup = parentOf) {
  const chain = new Set();
  let pid = Number(startPid);
  for (let hops = 0; hops < MAX_ANCESTORS; hops += 1) {
    if (!Number.isInteger(pid) || pid <= 1 || chain.has(pid)) break;
    chain.add(pid);
    const parent = parentLookup(pid);
    if (parent === null) break;
    pid = parent;
  }
  return chain;
}

/**
 * Pids of this app's leftovers, verified: the pid is alive and its command line
 * still looks like ours (so a recycled pid is not mistaken for one of them).
 *
 * `options` exists for tests: `processes`, `readCommand` and `exclude`.
 */
function collectAppPids(options = {}) {
  const readCommandImpl = options.readCommand || readCommand;
  const exclude = options.exclude || ownProcessChain(options.selfPid === undefined ? process.pid : options.selfPid, options.parentLookup);
  let rows;
  try {
    rows = options.processes || readProcessTable();
  } catch {
    return [];
  }

  const pids = [];
  for (const row of rows) {
    if (!isAppProcess(row.command) || exclude.has(row.pid)) continue;
    const live = readCommandImpl(row.pid);
    if (live === null || !isAppProcess(live)) continue;
    pids.push(row.pid);
  }
  return pids;
}

/**
 * The pid to free a port from, or why we will not touch it.
 *
 * A port occupant is a *listener*. A client with an established connection to
 * that port (a supervisor's health probe, say) is not one, and our own process
 * tree is never a target — killing the thing that launched us is how a
 * supervisor dies. `lsof -ti:${port}` (no LISTEN filter, first line only) used
 * to hand us exactly those pids.
 */
function portOccupantToKill(candidate, chain = ownProcessChain()) {
  const pid = Number(candidate);
  if (!Number.isInteger(pid) || pid <= 1) return { pid: null, reason: "none" };
  if (chain.has(pid)) return { pid: null, reason: "own-process-tree" };
  return { pid, reason: "ok" };
}

/** SIGKILL (or `taskkill /F`), best effort — a pid that vanished is not an error. */
function killAppPids(pids) {
  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: "ignore", shell: true, windowsHide: true, timeout: 3000 });
      } else {
        execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
      }
    } catch {
      /* already dead */
    }
  }
  return pids.length;
}

module.exports = {
  isAppProcess,
  looksLikeNode,
  parseProcessTable,
  parseWindowsProcessTable,
  readProcessTable,
  readCommand,
  ownProcessChain,
  portOccupantToKill,
  collectAppPids,
  killAppPids,
  maxAncestors: MAX_ANCESTORS,
};
