import fs from "fs";
import path from "path";
import os from "os";
import { spawn, execFileSync, execSync } from "child_process";
import { DATA_DIR } from "./dataDir.js";

const CONFIG_FILE = path.join(DATA_DIR, "mux-settings.json");
const PID_FILE = path.join(DATA_DIR, "mux.pid");

export function getDefaultMuxPath() {
  if (process.platform === "win32") {
    // Windows has a 260 character path length limit (MAX_PATH).
    // Using a user-home dot-folder avoids path overflow in deep node_modules packages.
    return path.join(os.homedir(), ".9r-mux");
  }
  return path.join(DATA_DIR, "mux");
}

const DEFAULT_CONFIG = {
  host: "127.0.0.1",
  port: 20130, 
  authToken: "mux-9router-secret-token",
  noAuth: true,
  muxPath: getDefaultMuxPath(),
};

let muxProcess = null;
let lastCpuTime = null;
let lastSampleTime = null;
let lastSystemCpu = null;
let lastProcessCpu = 0;

// The Mux dashboard polls this module every few seconds.  Keep expensive
// process probes and `npm prefix -g` lookups bounded so a status page cannot
// continually create helper processes on Windows.
const MUX_ENTRY_TTL_MS = 30_000;
const PROCESS_STATS_TTL_MS = 10_000;
let muxEntryCache = { value: undefined, fetchedAt: 0 };
let processStatsCache = { pid: null, value: null, fetchedAt: 0 };

// Global install state
export let installStatus = {
  state: "idle", // "idle", "cloning", "installing_dependencies", "building", "completed", "failed"
  progress: 0,
  log: [],
  error: null,
};

let installProcess = null; // Reference to active clone/build process for cancellation
let installAttempt = 0;
let muxStartPromise = null;

function quoteForLog(arg) {
  const value = String(arg);
  return /\s/.test(value) ? JSON.stringify(value) : value;
}

function npmInvocation() {
  // npm.cmd requires cmd.exe on Windows.  Invoke npm's JavaScript entry with
  // this Node runtime instead, which keeps the launch shell-free.  The env
  // override is also useful for packaged/custom Node installations.
  const candidates = [
    process.env.NINEROUTER_NPM_CLI,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmCli = candidates.find((candidate) => fs.existsSync(candidate));
  if (npmCli) {
    return { command: process.execPath, prefixArgs: [npmCli], shell: false };
  }

  // A normal Node installation always has npm-cli.js above.  On Windows a
  // fallback to npm.cmd implicitly creates cmd.exe, which is exactly the
  // console-flash failure this manager must avoid.  Fail with an actionable
  // error instead of silently taking that unsafe path.
  if (process.platform === "win32") {
    const error = new Error(
      "npm-cli.js was not found next to the current Node runtime; refusing to launch npm.cmd through cmd.exe"
    );
    error.code = "NPM_CLI_NOT_FOUND";
    throw error;
  }
  return { command: "npm", prefixArgs: [], shell: false };
}

function runNpmSync(args, options = {}) {
  const invocation = npmInvocation();
  return execFileSync(invocation.command, [...invocation.prefixArgs, ...args], {
    windowsHide: true,
    shell: invocation.shell,
    ...options,
  });
}

function getInstallInvocation(command, args) {
  if (command !== "npm") return { command, args, shell: false };
  const invocation = npmInvocation();
  return {
    command: invocation.command,
    args: [...invocation.prefixArgs, ...args],
    shell: invocation.shell,
  };
}

function invalidateMuxEntryCache() {
  muxEntryCache = { value: undefined, fetchedAt: 0 };
}

// Helper to load settings
export function loadMuxConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e) {
    console.error("[MuxManager] Failed to load config:", e);
  }
  return { ...DEFAULT_CONFIG };
}

// Helper to save settings
export function saveMuxConfig(config) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.error("[MuxManager] Failed to save config:", e);
    return false;
  }
}

// Save PID to file
function savePid(pid) {
  try {
    fs.writeFileSync(PID_FILE, pid.toString(), "utf-8");
  } catch (e) {
    console.error("[MuxManager] Failed to save PID:", e);
  }
}

// Load PID from file
function loadPid() {
  try {
    if (fs.existsSync(PID_FILE)) {
      return parseInt(fs.readFileSync(PID_FILE, "utf-8"), 10);
    }
  } catch { /* ignore */ }
  return null;
}

// Clear PID file
function clearPid() {
  try {
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
  } catch { /* ignore */ }
}

// Check if PID is running
function isPidRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateMuxPid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 5000,
      });
      console.log(`[MuxManager] Stopped Mux process tree with PID ${pid}`);
    } catch { /* already stopped or inaccessible */ }
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`[MuxManager] Stopped Mux process with PID ${pid}`);
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch { /* ignore */ }
  }
}

// Get system CPU usage
function getSystemCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  cpus.forEach((core) => {
    for (const type in core.times) {
      totalTick += core.times[type];
    }
    totalIdle += core.times.idle;
  });
  return { idle: totalIdle / cpus.length, total: totalTick / cpus.length };
}

function getSystemCpuPercent() {
  const current = getSystemCpuUsage();
  if (lastSystemCpu) {
    const idleDifference = current.idle - lastSystemCpu.idle;
    const totalDifference = current.total - lastSystemCpu.total;
    const percentage = 100 - Math.round((100 * idleDifference) / totalDifference);
    lastSystemCpu = current;
    return Math.max(0, Math.min(100, percentage));
  }
  lastSystemCpu = current;
  return 0;
}

// Get process resource stats (CPU time and memory)
function getProcessStats(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { cpuSeconds: 0, cpuPercent: 0, memoryBytes: 0 };
  }
  try {
    if (process.platform === "win32") {
      const script = `$process = Get-Process -Id ${pid} -ErrorAction Stop; \"$($process.CPU),$($process.WorkingSet64)\"`;
      const output = execFileSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script,
      ], { encoding: "utf8", windowsHide: true, timeout: 2000 });
      const parts = output.trim().split(",");
      if (parts.length === 2) {
        return {
          cpuSeconds: parseFloat(parts[0]),
          memoryBytes: parseInt(parts[1], 10),
        };
      }
    } else {
      const output = execSync(`ps -p ${pid} -o %cpu,rss`, { encoding: "utf8" });
      const lines = output.trim().split("\n");
      if (lines.length > 1) {
        const parts = lines[1].trim().split(/\s+/);
        if (parts.length >= 2) {
          return {
            cpuPercent: Math.round(parseFloat(parts[0])),
            memoryBytes: parseInt(parts[1], 10) * 1024,
          };
        }
      }
    }
  } catch { /* ignore */ }
  return { cpuSeconds: 0, cpuPercent: 0, memoryBytes: 0 };
}

function getCachedProcessStats(pid) {
  const now = Date.now();
  if (
    processStatsCache.pid === pid
    && processStatsCache.value
    && now - processStatsCache.fetchedAt < PROCESS_STATS_TTL_MS
  ) {
    return { value: processStatsCache.value, fresh: false };
  }

  const value = getProcessStats(pid);
  processStatsCache = { pid, value, fetchedAt: now };
  return { value, fresh: true };
}

// Check Mux running state
export function isMuxRunning() {
  if (muxProcess && isPidRunning(muxProcess.pid)) {
    return true;
  }
  const savedPid = loadPid();
  if (savedPid && isPidRunning(savedPid)) {
    return true;
  }
  return false;
}

// Stop Mux process
export function stopMux() {
  const savedPid = loadPid();
  if (savedPid) {
    terminateMuxPid(savedPid);
  }
  if (muxProcess) {
    if (muxProcess.pid && muxProcess.pid !== savedPid) terminateMuxPid(muxProcess.pid);
    muxProcess = null;
  }
  clearPid();
  return true;
}

// Resolve the globally installed mux CLI entry point
export function getMuxGlobalEntry() {
  if (
    muxEntryCache.value !== undefined
    && Date.now() - muxEntryCache.fetchedAt < MUX_ENTRY_TTL_MS
  ) {
    return muxEntryCache.value;
  }

  let entry = null;
  try {
    // Find where npm installs global packages
    const globalPrefix = runNpmSync(["prefix", "-g"], { encoding: "utf8", timeout: 5000 }).trim();
    // On Windows: C:\Users\User\AppData\Roaming\npm\node_modules\mux\dist\cli\index.js
    const winEntry = path.join(globalPrefix, "node_modules", "mux", "dist", "cli", "index.js");
    if (fs.existsSync(winEntry)) {
      entry = { fullPath: winEntry, cwd: path.dirname(path.dirname(path.dirname(winEntry))) };
    } else {
      // On Unix: /usr/local/lib/node_modules/mux/dist/cli/index.js
      const unixEntry = path.join(globalPrefix, "lib", "node_modules", "mux", "dist", "cli", "index.js");
      if (fs.existsSync(unixEntry)) {
        entry = { fullPath: unixEntry, cwd: path.dirname(path.dirname(path.dirname(unixEntry))) };
      }
    }
  } catch (e) {
    console.error("[MuxManager] Could not resolve npm global prefix:", e.message);
  }
  muxEntryCache = { value: entry, fetchedAt: Date.now() };
  return entry;
}

// Start Mux process using globally installed mux CLI
export async function startMux() {
  if (muxStartPromise) return muxStartPromise;

  const start = startMuxInternal();
  muxStartPromise = start;
  try {
    return await start;
  } finally {
    if (muxStartPromise === start) muxStartPromise = null;
  }
}

async function startMuxInternal() {
  if (isMuxRunning()) {
    return { success: true, message: "Mux is already running" };
  }

  const entry = getMuxGlobalEntry();
  if (!entry) {
    return {
      success: false,
      message: "Mux is not installed globally. Please click 'Install Mux' first.",
    };
  }

  const config = loadMuxConfig();

  // Inject 9Router into Mux's providers.jsonc
  try {
    inject9RouterIntoMuxProviders();
  } catch (e) {
    console.error("[MuxManager] Failed to inject 9Router provider config:", e);
  }

  const args = [entry.fullPath, "server",
    "--host", config.host,
    "--port", config.port.toString(),
  ];
  if (config.noAuth) {
    args.push("--no-auth");
  } else if (config.authToken) {
    args.push("--auth-token", config.authToken);
  }

  console.log(`[MuxManager] Starting Mux: ${process.execPath} ${args.join(" ")}`);

  const child = spawn(process.execPath, args, {
    cwd: entry.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  let exited = false;
  const clearChildState = () => {
    if (muxProcess === child) muxProcess = null;
    if (child.pid && loadPid() === child.pid) clearPid();
  };

  child.on("error", (error) => {
    console.error(`[MuxManager] Mux process error: ${error.message}`);
    clearChildState();
  });
  child.on("exit", () => {
    exited = true;
    clearChildState();
  });

  try {
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
  } catch (error) {
    clearChildState();
    return { success: false, message: `Could not start Mux: ${error.message}` };
  }

  if (exited || !child.pid || !isPidRunning(child.pid)) {
    clearChildState();
    return { success: false, message: "Mux exited before it could start" };
  }

  child.unref();
  muxProcess = child;
  savePid(child.pid);

  return { success: true, pid: child.pid };
}

// Inject 9Router as a provider in Mux's config
function inject9RouterIntoMuxProviders() {
  const providersPath = path.join(os.homedir(), ".mux", "providers.jsonc");
  const providersDir = path.dirname(providersPath);
  
  if (!fs.existsSync(providersDir)) {
    fs.mkdirSync(providersDir, { recursive: true });
  }

  let providersConfig = {};
  if (fs.existsSync(providersPath)) {
    try {
      // Very basic JSONC parsing by stripping comment lines
      const content = fs.readFileSync(providersPath, "utf-8");
      const cleanJson = content.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1');
      providersConfig = JSON.parse(cleanJson);
    } catch {
      providersConfig = {};
    }
  }

  // Add/Update 9router provider config
  providersConfig["9router"] = {
    providerType: "openai-compatible",
    baseUrl: "http://127.0.0.1:20128/v1",
    apiKey: "nine-router-agent-token",
    displayName: "9Router Local Agent",
    enabled: true,
    models: [
      { id: "gemini-3.5-flash-low", name: "Gemini 3.5 Flash" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet" },
      { id: "gpt-4o", name: "GPT-4o" }
    ]
  };

  fs.writeFileSync(providersPath, JSON.stringify(providersConfig, null, 2), "utf-8");
  console.log("[MuxManager] Injected 9Router provider config into ~/.mux/providers.jsonc");
}



export function getStats() {
  const activelyInstalling = ["cloning", "installing_dependencies", "building"].includes(installStatus.state);
  // Don't report installed=true while install is in progress (partial files may exist on disk)
  const installed = !activelyInstalling && getMuxGlobalEntry() !== null;

  const running = isMuxRunning();
  const pid = running ? (muxProcess?.pid || loadPid()) : null;

  let processCpu = 0;
  let processMemory = 0;

  if (pid) {
    const { value: pStats, fresh } = getCachedProcessStats(pid);
    processMemory = pStats.memoryBytes;
    
    if (process.platform === "win32") {
      if (fresh) {
        const now = Date.now();
        if (lastCpuTime !== null && lastSampleTime !== null) {
          const timeDiff = (now - lastSampleTime) / 1000;
          const cpuDiff = pStats.cpuSeconds - lastCpuTime;
          const cores = os.cpus().length;
          if (timeDiff > 0) {
            lastProcessCpu = Math.round(Math.min(100, Math.max(0, ((cpuDiff / timeDiff) / cores) * 100)));
          }
        }
        lastCpuTime = pStats.cpuSeconds;
        lastSampleTime = now;
      }
      processCpu = lastProcessCpu;
    } else {
      processCpu = pStats.cpuPercent || 0;
    }
  }

  // System stats
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const systemCpu = getSystemCpuPercent();

  return {
    running,
    pid,
    installed,
    process: {
      cpu: processCpu,
      memory: processMemory,
    },
    system: {
      cpu: systemCpu,
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
      },
      loadAverage: os.loadavg(),
    },
  };
}

// Run command and pipe output to install log
function runInstallCmd(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const invocation = getInstallInvocation(command, args);
    installStatus.log.push(`> ${command} ${args.map(quoteForLog).join(" ")}`);
    const proc = spawn(invocation.command, invocation.args, {
      cwd,
      shell: invocation.shell,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    installProcess = proc;
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (installProcess === proc) installProcess = null;
      if (error) reject(error);
      else resolve();
    };

    // stdout — plain output
    proc.stdout?.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        const clean = line.trim();
        if (clean) installStatus.log.push(clean);
      }
    });

    // stderr — npm sends ALL its output here (progress, warnings, errors)
    proc.stderr?.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        const clean = line.trim();
        if (!clean) continue;

        // Actual hard errors (npm error / npm ERR!)
        const isHardError =
          clean.toLowerCase().startsWith("npm error") ||
          clean.toLowerCase().startsWith("npm err!") ||
          clean.startsWith("error ");

        // Noise to skip (tar extraction warnings spam)
        const isNoise =
          clean.includes("TAR_ENTRY_ERROR") ||
          clean.includes("npm warn tar");

        if (isNoise) continue; // skip tar spam entirely
        if (isHardError) {
          installStatus.log.push(`[ERR] ${clean}`);
        } else {
          // Everything else (npm http, added N packages, npm warn, etc.) shown cleanly
          installStatus.log.push(clean);
        }
      }
    });

    proc.on("error", (error) => {
      console.error(`[MuxManager] Install command could not start: ${error.message}`);
      finish(error);
    });

    proc.on("close", (code) => {
      if (code === 0) finish();
      else finish(new Error(`Command failed with exit code ${code}`));
    });
  });
}

// Cancel current Mux installation
export function cancelInstall() {
  const processToCancel = installProcess;
  installAttempt += 1;
  if (processToCancel) {
    try {
      if (process.platform === "win32" && processToCancel.pid) {
        // Kill only the known npm process tree.  The old image-name kill could
        // terminate unrelated Bun work on the user's machine.
        execFileSync("taskkill.exe", ["/PID", String(processToCancel.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
          timeout: 5000,
        });
      } else {
        processToCancel.kill("SIGKILL");
      }
    } catch { /* ignore */ }
    if (installProcess === processToCancel) installProcess = null;
  }
  installStatus.state = "idle";
  installStatus.progress = 0;
  installStatus.log.push("--- Installation Cancelled by User ---");
  return true;
}

// Uninstall Mux (npm uninstall -g mux) and clear state
export function deleteMux() {
  stopMux();
  clearPid();
  invalidateMuxEntryCache();

  installStatus.state = "idle";
  installStatus.progress = 0;
  installStatus.log = [];
  installStatus.error = null;

  // Run npm uninstall -g mux in background (non-blocking)
  try {
    runNpmSync(["uninstall", "-g", "mux", "--ignore-scripts"], {
      stdio: "ignore",
      timeout: 60_000,
    });
    console.log("[MuxManager] Uninstalled mux globally via npm");
  } catch (e) {
    console.error("[MuxManager] npm uninstall failed (may already be removed):", e.message);
  }

  return { success: true };
}

// Install Mux globally using the official method: npm install -g mux
export async function installMux() {
  if (installStatus.state !== "idle" && installStatus.state !== "failed") {
    return { success: false, message: "Installation is already in progress" };
  }

  const attempt = ++installAttempt;

  installStatus.state = "installing_dependencies";
  installStatus.progress = 10;
  installStatus.log = [
    "Starting Mux installation...",
    "Using official method: npm install -g mux",
    "This may take 1-3 minutes depending on network speed...",
  ];
  installStatus.error = null;

  (async () => {
    // Heartbeat: append a dot every 3s so the terminal shows life during silent npm download
    let dots = 0;
    const heartbeat = setInterval(() => {
      if (attempt !== installAttempt || installStatus.state !== "installing_dependencies") {
        clearInterval(heartbeat);
        return;
      }
      dots++;
      const mb = Math.min(30 + dots * 2, 75);
      installStatus.progress = mb;
      installStatus.log.push(`⏳ Downloading packages... (${dots * 3}s elapsed)`);
    }, 3000);

    try {
      installStatus.log.push("Running: npm install -g mux --ignore-scripts");
      installStatus.progress = 30;

      // Use --loglevel=http to get per-package fetch lines from npm
      await runInstallCmd(
        "npm",
        ["install", "-g", "mux", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=http"],
        os.homedir()
      );

      if (attempt !== installAttempt) {
        clearInterval(heartbeat);
        return;
      }
      clearInterval(heartbeat);
      installStatus.progress = 85;
      installStatus.log.push("✓ Packages installed. Injecting 9Router provider config...");

      try {
        inject9RouterIntoMuxProviders();
        installStatus.log.push("✓ 9Router provider injected into ~/.mux/providers.jsonc");
      } catch (e) {
        console.error("Failed to inject 9Router config:", e);
      }

      invalidateMuxEntryCache();
      installStatus.state = "completed";
      installStatus.progress = 100;
      installStatus.log.push("✓ Mux installed successfully! Click 'Start Mux' to launch.");
    } catch (err) {
      clearInterval(heartbeat);
      if (attempt !== installAttempt) return;
      console.error(err);
      installStatus.state = "failed";
      installStatus.error = err.message;
      installStatus.log.push(`[ERROR] Installation failed: ${err.message}`);
    }
  })();

  return { success: true };
}
