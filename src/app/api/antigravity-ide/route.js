import { execSync, spawn } from "child_process";
import os from "os";
import fs from "fs";
import path from "path";

const PLATFORM = os.platform();

// Antigravity IDE paths
const CLI_PATH = path.join(os.homedir(), ".antigravity", "antigravity", "bin", "antigravity");
const APP_BUNDLE = "Antigravity.app";
const PROCESS_SEARCH_TERM = "Antigravity.app";

/**
 * Check if the Antigravity CLI exists
 */
function detectCli() {
  // Check custom CLI path first
  if (fs.existsSync(CLI_PATH)) {
    return { found: true, command: CLI_PATH };
  }
  // Check PATH
  try {
    const which = PLATFORM === "win32" ? "where" : "which";
    const result = execSync(`${which} antigravity`, { encoding: "utf8", stdio: "pipe", timeout: 5000 }).trim();
    if (result) return { found: true, command: result };
  } catch { /* not in PATH */ }
  return { found: false, command: null };
}

/**
 * Detect running Antigravity processes (macOS: pgrep, Windows: tasklist)
 */
function detectProcesses() {
  const pids = [];
  try {
    if (PLATFORM === "darwin") {
      const output = execSync(`pgrep -f "${PROCESS_SEARCH_TERM}"`, {
        encoding: "utf8", stdio: "pipe", timeout: 5000,
      });
      output.trim().split("\n").filter(Boolean).forEach(p => {
        const n = parseInt(p, 10);
        if (!isNaN(n)) pids.push(n);
      });
    } else if (PLATFORM === "win32") {
      const output = execSync(`tasklist /FI "IMAGENAME eq Antigravity.exe" /NH`, {
        encoding: "utf8", stdio: "pipe", timeout: 5000,
      });
      if (!output.includes("No tasks")) {
        for (const line of output.split("\n").filter(l => l.includes("Antigravity"))) {
          const match = line.match(/\s+(\d+)\s/);
          if (match) pids.push(parseInt(match[1], 10));
        }
      }
    }
  } catch { /* pgrep exit 1 = no match */ }
  return { running: pids.length > 0, pids: [...new Set(pids)] };
}

/**
 * Find the main Electron process PID (macOS only).
 * Main process has ppid=1 and contains /Contents/MacOS/ without Helper.
 */
function findMainPid(pids) {
  if (PLATFORM !== "darwin" || pids.length === 0) return pids[0] || null;
  try {
    const output = execSync(`ps -o pid=,ppid=,comm= -p ${pids.join(",")}`, {
      encoding: "utf8", stdio: "pipe", timeout: 5000,
    });
    for (const line of output.trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      const comm = parts.slice(2).join(" ");
      if (ppid === 1 && comm.includes("/Contents/MacOS/") && !comm.includes("Helper") && !comm.includes("crashpad")) {
        return pid;
      }
    }
  } catch { /* ignore */ }
  return pids[0] || null;
}

/**
 * Kill running Antigravity processes
 */
function killProcesses(pids) {
  let killed = 0;
  if (PLATFORM === "darwin") {
    const mainPid = findMainPid(pids);
    if (mainPid) {
      try {
        execSync(`kill ${mainPid}`, { stdio: "pipe", timeout: 5000 });
        killed++;
      } catch { /* already exited */ }
    }
  } else if (PLATFORM === "win32") {
    try {
      execSync(`taskkill /F /IM Antigravity.exe`, { stdio: "pipe", timeout: 5000 });
      killed++;
    } catch { /* ignore */ }
  } else {
    for (const pid of pids) {
      try {
        execSync(`kill ${pid}`, { stdio: "pipe", timeout: 5000 });
        killed++;
      } catch { /* ignore */ }
    }
  }
  return killed;
}

/**
 * Launch Antigravity IDE as a detached process
 */
function launchIde(command) {
  const options = PLATFORM === "win32"
    ? { stdio: "ignore", shell: true, windowsHide: true }
    : { detached: true, stdio: "ignore" };

  const child = spawn(command, [], options);
  child.on("error", (err) => console.error(`[antigravity-ide] Spawn error: ${err.message}`));
  child.unref();
  return child.pid;
}

/**
 * GET /api/antigravity-ide — Detect IDE status
 */
export async function GET() {
  const cli = detectCli();
  const proc = detectProcesses();

  return Response.json({
    installed: cli.found,
    cli: cli.command,
    running: proc.running,
    pids: proc.pids,
  });
}

/**
 * POST /api/antigravity-ide — Relaunch IDE
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || "relaunch";

    if (action !== "relaunch") {
      return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const cli = detectCli();
    if (!cli.found) {
      return Response.json({
        success: false,
        error: "Antigravity IDE not found. Check CLI at ~/.antigravity/antigravity/bin/antigravity",
      }, { status: 404 });
    }

    // Kill existing processes
    const proc = detectProcesses();
    if (proc.running) {
      const killed = killProcesses(proc.pids);
      console.log(`[antigravity-ide] Killed ${killed} process(es), waiting 2s...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Launch
    const pid = launchIde(cli.command);
    console.log(`[antigravity-ide] Launched with PID ${pid}`);

    return Response.json({
      success: true,
      pid,
      wasRunning: proc.running,
      message: proc.running
        ? `Re-launched Antigravity IDE (PID ${pid})`
        : `Launched Antigravity IDE (PID ${pid})`,
    });
  } catch (error) {
    console.error(`[antigravity-ide] Error:`, error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
