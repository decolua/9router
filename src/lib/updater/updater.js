// Standalone detached updater process.
// Spawns `npm i -g <pkg>@latest`, exposes progress via tiny HTTP server.
// Survives after parent Next server exits (detached + unref by spawner).

const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");
const os = require("os");

const packageName = process.env.UPDATER_PKG_NAME || "9router";
const port = parseInt(process.env.UPDATER_PORT || "20129", 10);
const tailLines = parseInt(process.env.UPDATER_TAIL_LINES || "8", 10);
const maxRetries = parseInt(process.env.UPDATER_RETRIES || "3", 10);
const retryDelayMs = parseInt(process.env.UPDATER_RETRY_DELAY_MS || "5000", 10);
const lingerMs = parseInt(process.env.UPDATER_LINGER_MS || "30000", 10);
const waitMinMs = parseInt(process.env.UPDATER_WAIT_MIN_MS || "3000", 10);
const waitMaxMs = parseInt(process.env.UPDATER_WAIT_MAX_MS || "15000", 10);
const waitCheckMs = parseInt(process.env.UPDATER_WAIT_CHECK_MS || "500", 10);
const appPort = parseInt(process.env.UPDATER_APP_PORT || "20128", 10);

// Data directory (match mitm/paths.js logic)
function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}
const updateDir = path.join(getDataDir(), "update");
try { fs.mkdirSync(updateDir, { recursive: true }); } catch { /* best effort */ }
const statusFile = path.join(updateDir, "status.json");
const logFile = path.join(updateDir, "install.log");

const state = {
  phase: "starting",
  packageName,
  startedAt: Date.now(),
  finishedAt: null,
  attempt: 0,
  maxRetries,
  done: false,
  success: false,
  exitCode: null,
  error: null,
  logTail: [],
};

// `npm.cmd` / `npx.cmd` require cmd.exe when spawned directly on Windows. That
// creates a console host and can briefly flash even when this updater itself is
// detached. Run the JavaScript entrypoint with the current Node runtime instead.
function resolvePackageManager(command, args) {
  if (process.platform !== "win32") return { command, args };

  const base = path.basename(command).toLowerCase().replace(/\.cmd$/, "");
  if (base !== "npm" && base !== "npx") return { command, args };

  const cliName = `${base}-cli.js`;
  const npmBinDir = process.env.npm_execpath ? path.dirname(process.env.npm_execpath) : null;
  const candidates = [
    base === "npm" ? process.env.npm_execpath : npmBinDir ? path.join(npmBinDir, cliName) : null,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", cliName),
  ].filter(Boolean);
  const cli = candidates.find((candidate) => fs.existsSync(candidate));

  if (!cli) {
    throw new Error(`Cannot locate ${cliName} next to ${process.execPath}`);
  }

  return { command: process.execPath, args: [cli, ...args] };
}

function pushLog(line) {
  const trimmed = line.replace(/\r?\n$/, "");
  if (!trimmed) return;
  state.logTail.push(trimmed);
  if (state.logTail.length > tailLines) state.logTail = state.logTail.slice(-tailLines);
  try { fs.appendFileSync(logFile, `${trimmed}\n`); } catch { /* best effort */ }
}

function persistStatus() {
  try { fs.writeFileSync(statusFile, JSON.stringify(state, null, 2)); } catch { /* best effort */ }
}

function setPhase(phase) {
  state.phase = phase;
  persistStatus();
}

// HTTP server exposing status (browser polls this while Next server is dead)
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.url === "/update/status" || req.url === "/") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(state));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

server.on("error", (e) => {
  state.error = `status server error: ${e.message}`;
  persistStatus();
  finalize(false, null, state.error);
});

server.listen(port, "127.0.0.1", () => {
  persistStatus();
  waitForAppExit().then(runInstall).catch((error) => {
    pushLog(`[updater] wait error: ${error.message}`);
    finalize(false, null, error.message);
  });
});

// Check if app port is still being listened on (= app server still alive)
function isAppPortBusy() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(appPort, "127.0.0.1");
  });
}

// Wait for app process to fully exit before running npm (avoids Windows file-lock)
async function waitForAppExit() {
  setPhase("waitingForExit");
  pushLog(`[updater] waiting for app to exit (min ${Math.round(waitMinMs / 1000)}s)...`);

  // Hard minimum delay: OS needs time to release file handles
  await sleep(waitMinMs);

  // Poll app port until free or max timeout
  const deadline = Date.now() + (waitMaxMs - waitMinMs);
  while (Date.now() < deadline) {
    const busy = await isAppPortBusy();
    if (!busy) {
      pushLog(`[updater] app port :${appPort} is free, proceeding`);
      return;
    }
    await sleep(waitCheckMs);
  }
  pushLog(`[updater] timeout waiting for app, proceeding anyway`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function runInstall() {
  if (state.done) return;
  state.attempt += 1;
  setPhase("installing");
  pushLog(`[updater] attempt ${state.attempt}/${maxRetries} — npm i -g ${packageName} --prefer-online`);

  const args = ["i", "-g", packageName, "--prefer-online"];
  let settled = false;

  const finishAttempt = (code, spawnError) => {
    if (settled || state.done) return;
    settled = true;

    if (spawnError) pushLog(`[updater] spawn error: ${spawnError.message}`);
    if (!spawnError && code === 0) {
      finalize(true, code, null);
      return;
    }
    if (state.attempt < maxRetries) {
      pushLog(`[updater] retrying in ${Math.round(retryDelayMs / 1000)}s...`);
      setTimeout(runInstall, retryDelayMs);
      return;
    }
    finalize(
      false,
      code,
      spawnError?.message || `Install failed after ${maxRetries} attempts`
    );
  };

  let child;
  try {
    const invocation = resolvePackageManager(process.platform === "win32" ? "npm.cmd" : "npm", args);
    child = spawn(invocation.command, invocation.args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
  } catch (error) {
    finishAttempt(null, error);
    return;
  }

  const logOutput = (buf) => {
    buf.toString().split(/\r?\n/).forEach(pushLog);
    persistStatus();
  };
  child.stdout?.on("data", logOutput);
  child.stderr?.on("data", logOutput);
  child.stdout?.on("error", (error) => pushLog(`[updater] stdout error: ${error.message}`));
  child.stderr?.on("error", (error) => pushLog(`[updater] stderr error: ${error.message}`));
  child.on("error", (error) => finishAttempt(null, error));
  child.on("close", (code) => {
    pushLog(`[updater] npm exited with code ${code}`);
    finishAttempt(code, null);
  });
}

function openBrowser(url) {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "explorer.exe"
      : "xdg-open";
  try {
    const child = spawn(command, [url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    child.on("error", (error) => pushLog(`[updater] browser open failed: ${error.message}`));
    child.unref();
  } catch (error) {
    pushLog(`[updater] browser open failed: ${error.message}`);
  }
}

// Wait until app port is listening (server alive again), then open dashboard
async function waitForAppAndOpenBrowser() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const busy = await isAppPortBusy();
    if (busy) {
      openBrowser(`http://localhost:${appPort}/dashboard`);
      pushLog(`[updater] app ready, opened dashboard`);
      return;
    }
    await sleep(1000);
  }
  pushLog(`[updater] app not responding within 30s, skip browser open`);
}

function relaunchApp() {
  if (process.env.UPDATER_RELAUNCH !== "1") return;
  const cmd = process.env.UPDATER_RELAUNCH_CMD;
  if (!cmd) return;
  let args = [];
  try { args = JSON.parse(process.env.UPDATER_RELAUNCH_ARGS || "[]"); } catch { /* noop */ }
  try {
    const invocation = resolvePackageManager(cmd, args);
    const child = spawn(invocation.command, invocation.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false,
      env: { ...process.env, UPDATER_RELAUNCH: "", UPDATER_RELAUNCH_CMD: "", UPDATER_RELAUNCH_ARGS: "" },
    });
    child.on("error", (error) => pushLog(`[updater] relaunch failed: ${error.message}`));
    child.unref();
    pushLog(`[updater] relaunched: ${cmd} ${args.join(" ")} (pid=${child.pid})`);
    // Wait for new app to come up, then auto-open browser so user sees the result
    waitForAppAndOpenBrowser().catch((error) => pushLog(`[updater] relaunch wait failed: ${error.message}`));
  } catch (e) {
    pushLog(`[updater] relaunch failed: ${e.message}`);
  }
}

function finalize(success, exitCode, error) {
  if (state.done) return;
  state.done = true;
  state.success = success;
  state.exitCode = exitCode;
  state.error = error;
  state.finishedAt = Date.now();
  setPhase(success ? "done" : "error");
  if (success) relaunchApp();
  // Linger so browser can poll final status, then exit & close the port
  setTimeout(() => {
    try { server.close(); } catch { /* ignore */ }
    process.exit(success ? 0 : 1);
  }, lingerMs);
}
