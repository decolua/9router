/**
 * Instance Manager
 * Spawns and manages child 9router processes on separate ports with isolated DATA_DIR.
 */

const { spawn } = require("child_process");
const path = require("path");
const os = require("os");

// Map of instanceId -> { process, port, dataDir, startedAt, logs }
const runningInstances = new Map();

const MAX_LOG_LINES = 200;

function getDefaultDataDir(instanceId) {
  const appName = "9router";
  const platform = process.platform;
  const homeDir = os.homedir();

  // Inside Docker / any env with DATA_DIR set, place instance data as a subfolder
  if (process.env.DATA_DIR) {
    return path.join(process.env.DATA_DIR, `instance-${instanceId}`);
  }

  if (platform === "win32") {
    const base = process.env.APPDATA || path.join(homeDir, "AppData", "Roaming");
    return path.join(base, `${appName}-${instanceId}`);
  }
  return path.join(homeDir, `.${appName}-${instanceId}`);
}

function resolveServerPath() {
  const fs = require("fs");
  const candidates = [
    // Docker standalone: server.js is at /app/server.js (same dir as process.cwd())
    path.join(process.cwd(), "server.js"),
    // Dev / local build
    path.join(process.cwd(), "app", "server.js"),
    path.join(process.cwd(), "..", "app", "server.js"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function resolveNextBin() {
  const fs = require("fs");
  const candidates = [
    path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"),
    path.join(process.cwd(), "..", "node_modules", "next", "dist", "bin", "next"),
    path.join(process.cwd(), "node_modules", ".bin", "next"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function isDevMode() {
  return process.env.NODE_ENV !== "production";
}

/**
 * Start a 9router instance.
 * @param {object} instance - from localDb (id, name, port, dataDir)
 * @returns {{ ok: boolean, error?: string }}
 */
function startInstance(instance) {
  const { id, port, dataDir, name } = instance;

  if (runningInstances.has(id)) {
    const entry = runningInstances.get(id);
    if (isAlive(entry.pid)) {
      return { ok: false, error: "Instance is already running." };
    }
    runningInstances.delete(id);
  }

  const resolvedDataDir = dataDir || getDefaultDataDir(id);
  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "0.0.0.0",
    DATA_DIR: resolvedDataDir,
    NEXT_PUBLIC_BASE_URL: `http://localhost:${port}`,
    CHILD_INSTANCE_ID: String(id),
    CHILD_INSTANCE_NAME: name || "",
  };

  let spawnCmd, spawnArgs, spawnCwd;

  const serverPath = resolveServerPath();
  if (serverPath) {
    spawnCmd = process.execPath;
    spawnArgs = [serverPath];
    spawnCwd = path.dirname(serverPath);
  } else {
    // Local environment (dev or prod): fall back to `next start` / `next dev`
    const fs = require("fs");
    const nextBuildDir = path.join(process.cwd(), ".next");
    if (!fs.existsSync(nextBuildDir)) {
      return {
        ok: false,
        error: "Chưa có production build. Chạy `npm run build` trước rồi thử lại.",
      };
    }
    const nextBin = resolveNextBin();
    if (!nextBin) {
      return { ok: false, error: "Không tìm thấy next binary." };
    }
    spawnCmd = process.execPath;
    spawnArgs = [nextBin, "start", "--port", String(port)];
    spawnCwd = process.cwd();
  }

  const logs = [];
  const child = spawn(spawnCmd, spawnArgs, {
    cwd: spawnCwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    shell: false,
  });

  const appendLog = (line) => {
    logs.push({ ts: new Date().toISOString(), line: line.trimEnd() });
    if (logs.length > MAX_LOG_LINES) logs.shift();
  };

  child.stdout.on("data", (d) => d.toString().split("\n").filter(Boolean).forEach(appendLog));
  child.stderr.on("data", (d) => d.toString().split("\n").filter(Boolean).forEach(appendLog));

  child.on("exit", (code) => {
    appendLog(`[manager] process exited with code ${code ?? "unknown"}`);
    const entry = runningInstances.get(id);
    if (entry) entry.pid = null;
  });

  runningInstances.set(id, {
    pid: child.pid,
    port,
    dataDir: resolvedDataDir,
    startedAt: new Date().toISOString(),
    logs,
    child,
  });

  return { ok: true };
}

/**
 * Stop a running instance.
 */
function stopInstance(id) {
  const entry = runningInstances.get(id);
  if (!entry) return { ok: false, error: "Instance is not running." };

  try {
    if (entry.child && !entry.child.killed) {
      entry.child.kill("SIGTERM");
      setTimeout(() => {
        try { entry.child.kill("SIGKILL"); } catch (_) {}
      }, 3000);
    }
  } catch (_) {}

  runningInstances.delete(id);
  return { ok: true };
}

/**
 * Get runtime status of an instance.
 */
function getInstanceStatus(id) {
  const entry = runningInstances.get(id);
  if (!entry || !isAlive(entry.pid)) {
    return { running: false };
  }
  return {
    running: true,
    pid: entry.pid,
    port: entry.port,
    dataDir: entry.dataDir,
    startedAt: entry.startedAt,
  };
}

/**
 * Get recent logs for an instance.
 */
function getInstanceLogs(id) {
  const entry = runningInstances.get(id);
  return entry ? entry.logs.slice() : [];
}

/**
 * List all currently running instance IDs.
 */
function listRunning() {
  const result = [];
  for (const [id, entry] of runningInstances.entries()) {
    if (isAlive(entry.pid)) result.push(id);
    else runningInstances.delete(id);
  }
  return result;
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EACCES";
  }
}

module.exports = { startInstance, stopInstance, getInstanceStatus, getInstanceLogs, listRunning };
