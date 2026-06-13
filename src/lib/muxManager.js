import fs from "fs";
import path from "path";
import os from "os";
import { spawn, execSync } from "child_process";
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

// Global install state
export let installStatus = {
  state: "idle", // "idle", "cloning", "installing_dependencies", "building", "completed", "failed"
  progress: 0,
  log: [],
  error: null,
};

let installProcess = null; // Reference to active clone/build process for cancellation

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
  try {
    if (process.platform === "win32") {
      const { execSync } = require("child_process");
      const cmd = `powershell -NoProfile -NonInteractive -Command "(Get-Process -Id ${pid}).CPU.ToString() + ',' + (Get-Process -Id ${pid}).WorkingSet64.ToString()"`;
      const output = execSync(cmd, { encoding: 'utf8', windowsHide: true });
      const parts = output.trim().split(',');
      if (parts.length === 2) {
        return {
          cpuSeconds: parseFloat(parts[0]),
          memoryBytes: parseInt(parts[1], 10),
        };
      }
    } else {
      const { execSync } = require("child_process");
      const output = execSync(`ps -p ${pid} -o %cpu,rss`, { encoding: 'utf8' });
      const lines = output.trim().split('\n');
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
    try {
      process.kill(savedPid, "SIGTERM");
      console.log(`[MuxManager] Stopped Mux process with PID ${savedPid}`);
    } catch {
      try {
        process.kill(savedPid, "SIGKILL");
      } catch { /* ignore */ }
    }
  }
  if (muxProcess) {
    try {
      muxProcess.kill("SIGKILL");
    } catch { /* ignore */ }
    muxProcess = null;
  }
  clearPid();
  return true;
}

// Resolve the globally installed mux CLI entry point
export function getMuxGlobalEntry() {
  try {
    // Find where npm installs global packages
    const globalPrefix = execSync("npm prefix -g", { encoding: "utf8" }).trim();
    // On Windows: C:\Users\User\AppData\Roaming\npm\node_modules\mux\dist\cli\index.js
    const winEntry = path.join(globalPrefix, "node_modules", "mux", "dist", "cli", "index.js");
    if (fs.existsSync(winEntry)) {
      return { fullPath: winEntry, cwd: path.dirname(path.dirname(path.dirname(winEntry))) };
    }
    // On Unix: /usr/local/lib/node_modules/mux/dist/cli/index.js
    const unixEntry = path.join(globalPrefix, "lib", "node_modules", "mux", "dist", "cli", "index.js");
    if (fs.existsSync(unixEntry)) {
      return { fullPath: unixEntry, cwd: path.dirname(path.dirname(path.dirname(unixEntry))) };
    }
  } catch (e) {
    console.error("[MuxManager] Could not resolve npm global prefix:", e.message);
  }
  return null;
}

// Start Mux process using globally installed mux CLI
export async function startMux() {
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

  console.log(`[MuxManager] Starting Mux: node ${args.join(" ")}`);

  const child = spawn("node", args, {
    cwd: entry.cwd,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

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
    const pStats = getProcessStats(pid);
    processMemory = pStats.memoryBytes;
    
    if (process.platform === "win32") {
      const now = Date.now();
      if (lastCpuTime !== null && lastSampleTime !== null) {
        const timeDiff = (now - lastSampleTime) / 1000;
        const cpuDiff = pStats.cpuSeconds - lastCpuTime;
        const cores = os.cpus().length;
        processCpu = Math.round(Math.min(100, Math.max(0, ((cpuDiff / timeDiff) / cores) * 100)));
      }
      lastCpuTime = pStats.cpuSeconds;
      lastSampleTime = now;
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
    const escapedArgs = args.map((arg) => {
      if (typeof arg !== "string") return arg;
      if (arg.includes(" ") && !arg.startsWith('"') && !arg.endsWith('"')) {
        return `"${arg}"`;
      }
      return arg;
    });

    installStatus.log.push(`> ${command} ${escapedArgs.join(" ")}`);
    const proc = spawn(command, escapedArgs, { cwd, shell: true });
    installProcess = proc;

    // stdout — plain output
    proc.stdout.on("data", (data) => {
      const lines = data.toString().split("\n");
      for (const line of lines) {
        const clean = line.trim();
        if (clean) installStatus.log.push(clean);
      }
    });

    // stderr — npm sends ALL its output here (progress, warnings, errors)
    proc.stderr.on("data", (data) => {
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

    proc.on("close", (code) => {
      installProcess = null;
      if (code === 0) resolve();
      else reject(new Error(`Command failed with exit code ${code}`));
    });
  });
}

// Cancel current Mux installation
export function cancelInstall() {
  if (installProcess) {
    try {
      installProcess.kill("SIGKILL");
    } catch { /* ignore */ }
    installProcess = null;
  }
  // Clear any zombie bun processes holding file locks on Windows
  if (process.platform === "win32") {
    try {
      execSync("taskkill /F /IM bun.exe", { stdio: "ignore" });
    } catch { /* ignore */ }
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

  installStatus.state = "idle";
  installStatus.progress = 0;
  installStatus.log = [];
  installStatus.error = null;

  // Run npm uninstall -g mux in background (non-blocking)
  try {
    execSync("npm uninstall -g mux --ignore-scripts", { stdio: "ignore" });
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
      if (installStatus.state !== "installing_dependencies") {
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

      clearInterval(heartbeat);
      installStatus.progress = 85;
      installStatus.log.push("✓ Packages installed. Injecting 9Router provider config...");

      try {
        inject9RouterIntoMuxProviders();
        installStatus.log.push("✓ 9Router provider injected into ~/.mux/providers.jsonc");
      } catch (e) {
        console.error("Failed to inject 9Router config:", e);
      }

      installStatus.state = "completed";
      installStatus.progress = 100;
      installStatus.log.push("✓ Mux installed successfully! Click 'Start Mux' to launch.");
    } catch (err) {
      clearInterval(heartbeat);
      console.error(err);
      installStatus.state = "failed";
      installStatus.error = err.message;
      installStatus.log.push(`[ERROR] Installation failed: ${err.message}`);
    }
  })();

  return { success: true };
}
