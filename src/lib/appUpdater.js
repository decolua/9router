import { spawn, execSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import { UPDATER_CONFIG } from "@/shared/constants/config";

const KILL_TIMEOUT_MS = 5000;
const PROCESS_WAIT_MS = 1500;

// Kill MITM server by PID file (MITM may run as admin/sudo)
function killMitmByPidFile() {
  try {
    const mitmPidFile = path.join(
      process.platform === "win32"
        ? path.join(process.env.APPDATA || "", "9router")
        : path.join(os.homedir(), ".9router"),
      "mitm",
      ".mitm.pid"
    );
    if (!fs.existsSync(mitmPidFile)) return;
    const pid = parseInt(fs.readFileSync(mitmPidFile, "utf8").trim(), 10);
    if (!pid) return;

    if (process.platform === "win32") {
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 3000 });
    } else {
      try {
        execSync(`sudo -n kill -9 ${pid} 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
      } catch {
        try { process.kill(pid, "SIGKILL"); } catch { /* best effort */ }
      }
    }
    try { fs.unlinkSync(mitmPidFile); } catch { /* best effort */ }
  } catch { /* best effort */ }
}

// Collect PIDs of all 9router-related processes (excluding current)
function collectAppPids() {
  const pids = [];
  const platform = process.platform;

  if (platform === "win32") {
    try {
      const psCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "Get-WmiObject Win32_Process -Filter 'Name=\\"node.exe\\"' | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"`;
      const output = execSync(psCmd, { encoding: "utf8", windowsHide: true, timeout: KILL_TIMEOUT_MS });
      const lines = output.split("\n").slice(1).filter(l => l.trim());
      lines.forEach(line => {
        const isAppProcess = line.toLowerCase().includes("9router") || line.toLowerCase().includes("next-server");
        if (isAppProcess) {
          const match = line.match(/^"(\d+)"/);
          if (match && match[1] && match[1] !== process.pid.toString()) pids.push(match[1]);
        }
      });
    } catch { /* no processes */ }

    try {
      const cfCmd = `powershell -NonInteractive -WindowStyle Hidden -Command "Get-Process cloudflared -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"`;
      const cfOut = execSync(cfCmd, { encoding: "utf8", windowsHide: true, timeout: KILL_TIMEOUT_MS });
      cfOut.split("\n").forEach(l => {
        const pid = l.trim();
        if (pid && !isNaN(pid)) pids.push(pid);
      });
    } catch { /* no cloudflared */ }
  } else {
    try {
      const output = execSync("ps aux 2>/dev/null", { encoding: "utf8", timeout: KILL_TIMEOUT_MS });
      output.split("\n").forEach(line => {
        const isAppProcess = line.includes("9router") || line.includes("next-server") || line.includes("cloudflared");
        if (isAppProcess) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[1];
          if (pid && !isNaN(pid) && pid !== process.pid.toString()) pids.push(pid);
        }
      });
    } catch { /* no processes */ }
  }

  return pids;
}

// Build the .bat content for Windows update flow
function buildWindowsScript(packageName) {
  return `@echo off
timeout /t 3 /nobreak >nul
echo Installing new version...
npm install -g ${packageName}@latest --prefer-online
if %ERRORLEVEL% EQU 0 (
  echo.
  echo Update completed. Run "${packageName}" to start.
) else (
  echo.
  echo Update failed. Try manually: npm install -g ${packageName}@latest
)
pause
`;
}

// Build the .sh content for macOS/Linux update flow
function buildUnixScript(packageName) {
  return `#!/bin/bash
echo "Installing new version..."
sleep 2

npm cache clean --force 2>/dev/null
EXIT_CODE=1
for i in 1 2 3; do
  npm install -g ${packageName}@latest --prefer-online 2>&1
  EXIT_CODE=$?
  [ $EXIT_CODE -eq 0 ] && break
  echo "Retry $i/3..."
  sleep 5
done

if [ $EXIT_CODE -eq 0 ]; then
  echo ""
  echo "Update completed. Run \\"${packageName}\\" to start."
else
  echo ""
  echo "Update failed (exit code: $EXIT_CODE)"
  echo "Try manually: npm install -g ${packageName}@latest"
fi
`;
}

// Kill all app-related processes to release file locks (esp. on Windows)
export async function killAppProcesses() {
  killMitmByPidFile();
  const pids = collectAppPids();
  const platform = process.platform;

  pids.forEach(pid => {
    try {
      if (platform === "win32") {
        execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: "ignore", shell: true, windowsHide: true, timeout: 3000 });
      } else {
        execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: "ignore", timeout: 3000 });
      }
    } catch { /* already dead */ }
  });

  if (pids.length > 0) {
    await new Promise(r => setTimeout(r, PROCESS_WAIT_MS));
  }
}

// Spawn detached updater script and schedule current process to exit
export function spawnUpdaterAndExit(packageName = UPDATER_CONFIG.npmPackageName) {
  const platform = process.platform;

  if (platform === "win32") {
    const scriptPath = path.join(os.tmpdir(), `${packageName}-update.bat`);
    fs.writeFileSync(scriptPath, buildWindowsScript(packageName));
    spawn("cmd", ["/c", "start", "", "cmd", "/c", scriptPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    }).unref();
  } else {
    const scriptPath = path.join(os.tmpdir(), `${packageName}-update.sh`);
    fs.writeFileSync(scriptPath, buildUnixScript(packageName), { mode: 0o755 });
    spawn("sh", [scriptPath], {
      detached: true,
      stdio: "inherit",
    }).unref();
  }

  setTimeout(() => process.exit(0), UPDATER_CONFIG.exitDelayMs);
}
