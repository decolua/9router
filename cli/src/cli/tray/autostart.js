const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const APP_NAME = "9router";
const APP_LABEL = "com.9router.autostart";

/**
 * Get the command to run 9router in tray mode
 */
function getStartCommand() {
  // Find the global npm bin path for 9router
  try {
    const npmBin = execSync("npm bin -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const routerPath = path.join(npmBin, "9router");
    if (fs.existsSync(routerPath)) {
      return `"${routerPath}" --tray --skip-update`;
    }
  } catch (e) {
    // npm not available or failed
  }
  
  // Fallback: use npx
  return "npx 9router --tray --skip-update";
}

/**
 * Enable auto startup on OS boot
 * @param {string} cliPath - Optional path to cli.js (defaults to auto-detect)
 * @returns {boolean} success
 */
function enableAutoStart(cliPath) {
  const platform = process.platform;
  
  // Skip on unsupported platforms
  if (!["darwin", "win32", "linux"].includes(platform)) {
    return false;
  }
  
  // Skip on Linux without GUI
  if (platform === "linux" && !process.env.DISPLAY) {
    return false;
  }
  
  try {
    if (platform === "darwin") {
      return enableMacOS(cliPath);
    } else if (platform === "win32") {
      return enableWindows(cliPath);
    } else if (platform === "linux") {
      return enableLinux(cliPath);
    }
  } catch (err) {
    // Silent fail - autostart is optional
  }
  
  return false;
}

/**
 * Disable auto startup
 * @returns {boolean} success
 */
function disableAutoStart() {
  const platform = process.platform;
  
  try {
    if (platform === "darwin") {
      return disableMacOS();
    } else if (platform === "win32") {
      return disableWindows();
    } else if (platform === "linux") {
      return disableLinux();
    }
  } catch (err) {
    // Silent fail
  }
  
  return false;
}

/**
 * Check if autostart is enabled
 * @returns {boolean}
 */
function isAutoStartEnabled() {
  const platform = process.platform;
  
  try {
    if (platform === "darwin") {
      const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
      return fs.existsSync(plistPath);
    } else if (platform === "win32") {
      const startupPath = path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${APP_NAME}.vbs`);
      return fs.existsSync(startupPath);
    } else if (platform === "linux") {
      const desktopPath = path.join(os.homedir(), ".config", "autostart", `${APP_NAME}.desktop`);
      return fs.existsSync(desktopPath);
    }
  } catch (e) {}
  
  return false;
}

// ============ macOS ============

function enableMacOS(cliPath) {
  const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
  const plistPath = path.join(launchAgentsDir, `${APP_LABEL}.plist`);
  
  // Ensure directory exists
  if (!fs.existsSync(launchAgentsDir)) {
    fs.mkdirSync(launchAgentsDir, { recursive: true });
  }
  
  // Get absolute paths for node and 9router script
  const nodePath = process.execPath;
  let routerScript;
  
  if (cliPath) {
    // Use provided path (from running cli.js)
    routerScript = path.resolve(cliPath);
  } else {
    // Fallback: try to resolve from npm bin
    try {
      const npmBin = execSync("npm bin -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      const routerLink = path.join(npmBin, "9router");
      routerScript = fs.realpathSync(routerLink);
    } catch (e) {
      // Last resort fallback
      routerScript = "/usr/local/lib/node_modules/9router/cli.js";
    }
  }
  
  // Determine user shell
  const userShell = process.env.SHELL || '/bin/zsh';
  
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${APP_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${userShell}</string>
        <string>-l</string>
        <string>-c</string>
        <string>${nodePath} ${routerScript} --tray --skip-update</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>/tmp/9router.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/9router.error.log</string>
</dict>
</plist>`;
  
  fs.writeFileSync(plistPath, plistContent);
  
  // Load the launch agent
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: "ignore" });
  } catch (e) {}
  
  return true;
}

function disableMacOS() {
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
  
  try {
    execSync(`launchctl unload "${plistPath}" 2>/dev/null`, { stdio: "ignore" });
  } catch (e) {}
  
  if (fs.existsSync(plistPath)) {
    fs.unlinkSync(plistPath);
  }
  
  return true;
}

// ============ Windows ============

function enableWindows(cliPath) {
  const startupDir = path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  const vbsPath = path.join(startupDir, `${APP_NAME}.vbs`);
  
  // Ensure startup directory exists
  if (!fs.existsSync(startupDir)) {
    return false;
  }
  
  // Get absolute paths
  const nodePath = process.execPath;
  let routerScript;
  
  if (cliPath) {
    // Use provided path (from running cli.js)
    routerScript = path.resolve(cliPath);
  } else {
    // Fallback: try to resolve from npm bin
    try {
      const npmBin = execSync("npm bin -g", { encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
      const routerLink = path.join(npmBin, "9router.cmd");
      if (fs.existsSync(routerLink)) {
        routerScript = routerLink;
      } else {
        // Try to resolve actual script
        const routerJs = path.join(npmBin, "../lib/node_modules/9router/cli.js");
        if (fs.existsSync(routerJs)) {
          routerScript = routerJs;
        }
      }
    } catch (e) {
      // Fallback
    }
  }
  
  // Create VBS script to run hidden (no console window)
  let vbsContent;
  if (routerScript && routerScript.endsWith(".js")) {
    // Run node directly with script
    vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${nodePath}"" ""${routerScript}"" --tray --skip-update", 0, False
`;
  } else if (routerScript) {
    // Run .cmd file
    vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """${routerScript}"" --tray --skip-update", 0, False
`;
  } else {
    // Fallback to npx
    vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "npx 9router --tray --skip-update", 0, False
`;
  }
  
  fs.writeFileSync(vbsPath, vbsContent);
  return true;
}

function disableWindows() {
  const vbsPath = path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${APP_NAME}.vbs`);
  
  if (fs.existsSync(vbsPath)) {
    fs.unlinkSync(vbsPath);
  }
  
  return true;
}

// ============ Linux ============

function enableLinux(cliPath) {
  const autostartDir = path.join(os.homedir(), ".config", "autostart");
  const desktopPath = path.join(autostartDir, `${APP_NAME}.desktop`);
  
  // Ensure directory exists
  if (!fs.existsSync(autostartDir)) {
    try {
      fs.mkdirSync(autostartDir, { recursive: true });
    } catch (e) {
      return false;
    }
  }
  
  // Get absolute paths
  const nodePath = process.execPath;
  let routerScript;
  
  if (cliPath) {
    // Use provided path (from running cli.js)
    routerScript = path.resolve(cliPath);
  } else {
    // Fallback: try to resolve from npm bin
    try {
      const npmBin = execSync("npm bin -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      const routerLink = path.join(npmBin, "9router");
      if (fs.existsSync(routerLink)) {
        routerScript = fs.realpathSync(routerLink);
      }
    } catch (e) {
      // Last resort fallback
      routerScript = "/usr/local/lib/node_modules/9router/cli.js";
    }
  }
  
  const desktopContent = `[Desktop Entry]
Type=Application
Name=9Router
Comment=9Router API Proxy
Exec=${nodePath} ${routerScript} --tray --skip-update
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`;
  
  fs.writeFileSync(desktopPath, desktopContent);
  return true;
}

function disableLinux() {
  const desktopPath = path.join(os.homedir(), ".config", "autostart", `${APP_NAME}.desktop`);
  
  if (fs.existsSync(desktopPath)) {
    fs.unlinkSync(desktopPath);
  }
  
  return true;
}

module.exports = {
  enableAutoStart,
  disableAutoStart,
  isAutoStartEnabled
};
