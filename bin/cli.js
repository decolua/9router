#!/usr/bin/env node

const { spawn, exec, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const os = require("os");

// Native spinner - no external dependency
function createSpinner(text) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  let interval = null;
  let currentText = text;
  return {
    start() {
      if (process.stdout.isTTY) {
        process.stdout.write(`\r${frames[0]} ${currentText}`);
        interval = setInterval(() => {
          process.stdout.write(`\r${frames[i++ % frames.length]} ${currentText}`);
        }, 80);
      }
      return this;
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (process.stdout.isTTY) {
        process.stdout.write("\r\x1b[K");
      }
    },
    succeed(msg) {
      this.stop();
      console.log(`✅ ${msg}`);
    },
    fail(msg) {
      this.stop();
      console.log(`❌ ${msg}`);
    }
  };
}

const pkg = require("../package.json");
const args = process.argv.slice(2);

// Configuration constants
const APP_NAME = pkg.name;
const DEFAULT_PORT = 20127;
const DEFAULT_HOST = "0.0.0.0";
const MAX_PORT_ATTEMPTS = 10;
const PROCESS_IDENTIFIERS = ['9router-fdk'];

// Parse arguments
let port = DEFAULT_PORT;
let host = DEFAULT_HOST;
let noBrowser = false;
let skipUpdate = false;
let showLog = false;
let trayMode = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" || args[i] === "-p") {
    port = parseInt(args[i + 1], 10) || DEFAULT_PORT;
    i++;
  } else if (args[i] === "--host" || args[i] === "-H") {
    host = args[i + 1] || DEFAULT_HOST;
    i++;
  } else if (args[i] === "--no-browser" || args[i] === "-n") {
    noBrowser = true;
  } else if (args[i] === "--log" || args[i] === "-l") {
    showLog = true;
  } else if (args[i] === "--skip-update") {
    skipUpdate = true;
  } else if (args[i] === "--tray" || args[i] === "-t") {
    trayMode = true;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
Usage: ${APP_NAME} [options]

Options:
  -p, --port <port>   Port to run the server (default: ${DEFAULT_PORT})
  -H, --host <host>   Host to bind (default: ${DEFAULT_HOST})
  -n, --no-browser    Don't open browser automatically
  -l, --log           Show server logs (default: hidden)
  -t, --tray          Run in system tray mode (background)
  --skip-update       Skip auto-update check
  -h, --help          Show this help message
  -v, --version       Show version
`);
    process.exit(0);
  } else if (args[i] === "--version" || args[i] === "-v") {
    console.log(pkg.version);
    process.exit(0);
  }
}

// Always use Node.js runtime with absolute path
const RUNTIME = process.execPath;

// Compare semver versions
function compareVersions(a, b) {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }
  return 0;
}

// Kill all app processes
function killAllAppProcesses() {
  return new Promise((resolve) => {
    try {
      const platform = process.platform;
      let pids = [];

      if (platform === "win32") {
        try {
          const output = execSync('tasklist /FO CSV /V 2>/dev/null | findstr /I "node"', { 
            encoding: 'utf8',
            shell: true,
            windowsHide: true,
            timeout: 5000
          });
          const lines = output.split('\n').filter(l => l.trim());
          
          lines.forEach(line => {
            const isAppProcess = line.toLowerCase().includes("9router-fdk") || 
                                 line.toLowerCase().includes("next-server");
            if (isAppProcess) {
              const match = line.match(/"node\.exe","(\d+)"/i);
              if (match && match[1] && match[1] !== process.pid.toString()) {
                pids.push(match[1]);
              }
            }
          });
        } catch (e) {}
      } else {
        try {
          const output = execSync('ps aux 2>/dev/null', { 
            encoding: 'utf8',
            timeout: 5000
          });
          const lines = output.split('\n');
          
          lines.forEach(line => {
            const isAppProcess = line.includes("9router-fdk") || line.includes("next-server");
            if (isAppProcess) {
              const parts = line.trim().split(/\s+/);
              const pid = parts[1];
              if (pid && !isNaN(pid) && pid !== process.pid.toString()) {
                pids.push(pid);
              }
            }
          });
        } catch (e) {}
      }

      if (pids.length > 0) {
        pids.forEach(pid => {
          try {
            if (platform === "win32") {
              execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore', shell: true, windowsHide: true, timeout: 3000 });
            } else {
              execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 });
            }
          } catch (err) {}
        });
        setTimeout(() => resolve(), 1000);
      } else {
        resolve();
      }
    } catch (err) {
      resolve();
    }
  });
}

// Kill process on port
function killProcessOnPort(port) {
  return new Promise((resolve) => {
    try {
      const platform = process.platform;
      let pid;

      if (platform === "win32") {
        try {
          const output = execSync(`netstat -ano | findstr :${port}`, { 
            encoding: 'utf8', 
            shell: true,
            windowsHide: true,
            timeout: 5000 
          }).trim();
          const lines = output.split('\n').filter(l => l.includes('LISTENING'));
          if (lines.length > 0) {
            pid = lines[0].trim().split(/\s+/).pop();
            execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore', shell: true, windowsHide: true, timeout: 3000 });
          }
        } catch (e) {}
      } else {
        try {
          const pidOutput = execSync(`lsof -ti:${port}`, { 
            encoding: 'utf8', 
            stdio: ['pipe', 'pipe', 'ignore'] 
          }).trim();
          if (pidOutput) {
            pid = pidOutput.split('\n')[0];
            execSync(`kill -9 ${pid} 2>/dev/null`, { stdio: 'ignore', timeout: 3000 });
          }
        } catch (e) {}
      }

      setTimeout(() => resolve(), 500);
    } catch (err) {
      resolve();
    }
  });
}

// Detect restricted environment
function isRestrictedEnvironment() {
  if (process.env.CODESPACES === "true" || process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    return "GitHub Codespaces";
  }
  if (fs.existsSync("/.dockerenv") || (fs.existsSync("/proc/1/cgroup") && fs.readFileSync("/proc/1/cgroup", "utf8").includes("docker"))) {
    return "Docker";
  }
  return null;
}

// Check for updates
function checkForUpdate() {
  return new Promise((resolve) => {
    if (skipUpdate) {
      resolve(null);
      return;
    }

    const spinner = createSpinner("Checking for updates...").start();
    let resolved = false;

    const safetyTimeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        spinner.stop();
        resolve(null);
      }
    }, 8000);

    const done = (version) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(safetyTimeout);
      spinner.stop();
      resolve(version);
    };

    const req = https.get(`https://registry.npmjs.org/${pkg.name}/latest`, { timeout: 3000 }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const latest = JSON.parse(data);
          if (latest.version && compareVersions(latest.version, pkg.version) > 0) {
            done(latest.version);
          } else {
            done(null);
          }
        } catch (e) {
          done(null);
        }
      });
    });

    req.on("error", () => done(null));
    req.on("timeout", () => { req.destroy(); done(null); });
  });
}

// Perform update
function performUpdate() {
  console.log(`\n🔄 Updating ${pkg.name}...\n`);

  try {
    const platform = process.platform;
    let updateScript, scriptPath, shellCmd;

    if (platform === "win32") {
      updateScript = `
Write-Host "📥 Installing new version..."
npm cache clean --force 2>$null
npm install -g ${pkg.name}@latest --prefer-online 2>&1 | Out-Host
if ($LASTEXITCODE -eq 0) {
  Write-Host ""
  Write-Host "✅ Update completed. Run '${pkg.name}' to start."
} else {
  Write-Host ""
  Write-Host "❌ Update failed. Try manually: npm install -g ${pkg.name}@latest"
}
Read-Host "Press Enter to continue"
`;
      scriptPath = path.join(os.tmpdir(), `${APP_NAME}-update.ps1`);
      fs.writeFileSync(scriptPath, updateScript);
      shellCmd = ["powershell.exe", ["-WindowStyle", "Normal", "-ExecutionPolicy", "Bypass", "-File", scriptPath]];
    } else {
      updateScript = `#!/bin/bash
echo "📥 Installing new version..."
sleep 1

pkill -f "${pkg.name}" 2>/dev/null || true
sleep 1

npm cache clean --force 2>/dev/null
npm install -g ${pkg.name}@latest --prefer-online 2>&1
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo ""
  echo "✅ Update completed. Run \\"${pkg.name}\\" to start."
else
  echo ""
  echo "❌ Update failed (exit code: $EXIT_CODE)"
  echo "💡 Try manually: npm install -g ${pkg.name}@latest"
fi
`;
      scriptPath = path.join(os.tmpdir(), `${APP_NAME}-update.sh`);
      fs.writeFileSync(scriptPath, updateScript, { mode: 0o755 });
      shellCmd = ["sh", [scriptPath]];
    }

    const child = spawn(shellCmd[0], shellCmd[1], {
      detached: true,
      stdio: "inherit",
      windowsHide: false
    });
    child.unref();
    process.exit(0);
  } catch (err) {
    console.error(`⚠️  Update failed: ${err.message}`);
    console.log(`   Run manually: npm install -g ${pkg.name}@latest\n`);
  }
}

// Open browser
function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  
  if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else if (platform === "win32") {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  
  exec(cmd, (err) => {
    if (err) {
      console.log(`Open browser manually: ${url}`);
    }
  });
}

// Find standalone server
const standaloneDir = path.join(__dirname, "..", ".next", "standalone");
const serverPath = path.join(standaloneDir, "server.js");

if (!fs.existsSync(serverPath)) {
  console.error("Error: Standalone build not found.");
  console.error("Please run 'npm run build' first.");
  process.exit(1);
}

// Show interface selection menu
async function showInterfaceMenu(latestVersion) {
  const { selectMenu } = require("../src/cli/utils/input");
  const { clearScreen } = require("../src/cli/utils/display");
  const { getEndpoint } = require("../src/cli/utils/endpoint");
  
  clearScreen();
  
  const displayHost = host === DEFAULT_HOST ? "localhost" : host;
  
  let serverUrl;
  try {
    const { endpoint, tunnelEnabled } = await getEndpoint(port);
    serverUrl = tunnelEnabled ? endpoint.replace(/\/v1$/, "") : `http://${displayHost}:${port}`;
  } catch (e) {
    serverUrl = `http://${displayHost}:${port}`;
  }
  
  const subtitle = `🚀 Server: \x1b[32m${serverUrl}\x1b[0m`;
  
  const menuItems = [];
  
  if (latestVersion) {
    menuItems.push({ label: `Update to v${latestVersion} (current: v${pkg.version})`, icon: "⬆" });
  }
  
  menuItems.push(
    { label: "Web UI (Open in Browser)", icon: "🌐" },
    { label: "Terminal UI (Interactive CLI)", icon: "💻" },
    { label: "Hide to Tray (Background)", icon: "🔔" },
    { label: "Exit", icon: "🚪" }
  );
  
  const selected = await selectMenu(`Choose Interface (v${pkg.version})`, menuItems, 0, subtitle);
  
  const offset = latestVersion ? 1 : 0;
  
  if (latestVersion && selected === 0) return "update";
  if (selected === offset) return "web";
  if (selected === offset + 1) return "terminal";
  if (selected === offset + 2) return "hide";
  return "exit";
}

// Start server
function startServer(latestVersion) {
  const displayHost = host === DEFAULT_HOST ? "localhost" : host;
  const url = `http://${displayHost}:${port}/dashboard`;

  const server = spawn(RUNTIME, [serverPath], {
    cwd: standaloneDir,
    stdio: showLog ? "inherit" : "ignore",
    detached: true,
    env: {
      ...process.env,
      PORT: port.toString(),
      HOSTNAME: host
    }
  });

  // Cleanup function
  let isCleaningUp = false;
  function cleanup() {
    if (isCleaningUp) return;
    isCleaningUp = true;
    try {
      try {
        const { killTray } = require("../src/cli/tray/tray");
        killTray();
      } catch (e) {}
      if (server.pid) {
        process.kill(server.pid, "SIGKILL");
      }
      process.kill(-server.pid, "SIGKILL");
    } catch (e) {}
  }

  // Suppress errors during shutdown
  let isShuttingDown = false;
  process.on("uncaughtException", (err) => {
    if (isShuttingDown) return;
    console.error("Error:", err.message);
  });

  process.on("SIGINT", () => {
    isShuttingDown = true;
    cleanup();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    isShuttingDown = true;
    cleanup();
    process.exit(0);
  });

  server.on("error", (err) => {
    console.error("Server error:", err.message);
    process.exit(1);
  });

  server.on("exit", (code) => {
    if (!isShuttingDown) {
      console.log(`Server exited with code ${code}`);
      process.exit(code || 0);
    }
  });

  // Wait for server to start
  setTimeout(async () => {
    console.log(`\n✅ Server started on port ${port}`);
    
    // Handle tray mode directly
    if (trayMode) {
      console.log("Starting in tray mode...\n");
      try {
        const { initTray } = require("../src/cli/tray/tray");
        const tray = await initTray({
          port,
          onQuit: () => {
            isShuttingDown = true;
            cleanup();
            process.exit(0);
          },
          onOpenDashboard: () => {
            openBrowser(url);
          }
        });
        
        if (tray) {
          console.log("✅ Running in system tray");
          console.log("   Click tray icon to access menu\n");
        } else {
          console.log("⚠️  System tray not supported on this platform");
          console.log(`   Server running at: ${url}\n`);
        }
      } catch (err) {
        console.log("⚠️  Failed to initialize tray:", err.message);
        console.log(`   Server running at: ${url}\n`);
      }
      return;
    }

    // Show interface menu
    try {
      const choice = await showInterfaceMenu(latestVersion);
      
      if (choice === "update") {
        performUpdate();
      } else if (choice === "web") {
        console.log(`\n🌐 Opening dashboard in browser...\n`);
        openBrowser(url);
        console.log(`Server running at: ${url}`);
        console.log("Press Ctrl+C to stop\n");
      } else if (choice === "terminal") {
        const { startTerminalUI } = require("../src/cli/terminalUI");
        await startTerminalUI(port);
      } else if (choice === "hide") {
        console.log("\n🔔 Hiding to system tray...\n");
        try {
          const { initTray } = require("../src/cli/tray/tray");
          const tray = await initTray({
            port,
            onQuit: () => {
              isShuttingDown = true;
              cleanup();
              process.exit(0);
            },
            onOpenDashboard: () => {
              openBrowser(url);
            }
          });
          
          if (tray) {
            console.log("✅ Running in system tray");
            console.log("   Click tray icon to access menu\n");
          } else {
            console.log("⚠️  System tray not supported on this platform");
            console.log(`   Server running at: ${url}`);
            console.log("   Press Ctrl+C to stop\n");
          }
        } catch (err) {
          console.log("⚠️  Failed to initialize tray:", err.message);
          console.log(`   Server running at: ${url}`);
          console.log("   Press Ctrl+C to stop\n");
        }
      } else {
        console.log("\n👋 Exiting...\n");
        isShuttingDown = true;
        cleanup();
        process.exit(0);
      }
    } catch (err) {
      console.error("Error showing menu:", err.message);
      console.log(`\nServer running at: ${url}`);
      console.log("Press Ctrl+C to stop\n");
    }
  }, 3000);
}

// Main execution
checkForUpdate().then((latestVersion) => {
  killAllAppProcesses().then(() => {
    return killProcessOnPort(port);
  }).then(() => {
    startServer(latestVersion);
  });
});
