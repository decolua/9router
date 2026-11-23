"use strict";

const { execSync } = require("child_process");

const GRACEFUL_TIMEOUT_MS = 3000;
const WINDOWS_GRACEFUL_TASKKILL_TIMEOUT_MS = 2000;
const WINDOWS_FORCE_TASKKILL_TIMEOUT_MS = 3000;

function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch {}
}

function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    sleepSync(100);
  }
  return false;
}

function send(kill, pid, signal) {
  try { kill(pid, signal); return true; } catch { return false; }
}

function stopWindowsProcess(pid, exec, wait, timeoutMs) {
  try {
    exec(`taskkill /T /PID ${pid}`, {
      stdio: "ignore",
      windowsHide: true,
      timeout: WINDOWS_GRACEFUL_TASKKILL_TIMEOUT_MS,
    });
  } catch {}
  if (wait(pid, timeoutMs)) return { pid, graceful: true, forced: false };

  try {
    exec(`taskkill /F /T /PID ${pid}`, {
      stdio: "ignore",
      windowsHide: true,
      timeout: WINDOWS_FORCE_TASKKILL_TIMEOUT_MS,
    });
  } catch {}
  return { pid, graceful: false, forced: true };
}

function stopServerProcess(pid, options = {}) {
  if (!pid) return { pid: null, graceful: false, forced: false };

  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? GRACEFUL_TIMEOUT_MS;
  const kill = options.kill ?? process.kill;
  const exec = options.exec ?? execSync;
  const wait = options.waitForExit ?? waitForExit;

  if (platform === "win32") return stopWindowsProcess(pid, exec, wait, timeoutMs);

  send(kill, pid, "SIGTERM");
  if (wait(pid, timeoutMs)) return { pid, graceful: true, forced: false };

  if (!send(kill, -pid, "SIGKILL")) send(kill, pid, "SIGKILL");
  return { pid, graceful: false, forced: true };
}

module.exports = { GRACEFUL_TIMEOUT_MS, waitForExit, sleepSync, stopServerProcess };
