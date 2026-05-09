const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

let trayInstance = null;

/**
 * Get icon base64 from file — use .ico on Windows, .png on macOS/Linux
 */
function getIconBase64() {
  const isWin = process.platform === "win32";
  const iconFile = isWin ? "icon.ico" : "icon.png";
  try {
    const iconPath = path.join(__dirname, iconFile);
    if (fs.existsSync(iconPath)) {
      return fs.readFileSync(iconPath).toString("base64");
    }
  } catch (e) {}
  // Fallback: minimal green dot icon (PNG)
  return "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAALEwAACxMBAJqcGAAAAHpJREFUOE9jYBgFgwEwMjIy/Gdg+P8fyP4PxP8ZGBgEcBnGyMjIsICBgSEAhyH/gfgBUNN8XJoZsdkCVL8Ah+b/QPwbqvkBMvk/AwMDAzYX/GdgYAhAN+A/SICRWAMYGfFEJSMjzriEiwDR/xmIa2RkZCSqnZERb3QCAAo3KxzxbKe1AAAAAElFTkSuQmCC";
}

/**
 * Check if system tray is supported on current OS
 * Supported: macOS, Windows, Linux (with GUI)
 */
function isTraySupported() {
  const platform = process.platform;
  // Supported platforms: darwin (macOS), win32 (Windows), linux
  if (!["darwin", "win32", "linux"].includes(platform)) {
    return false;
  }
  // Skip on Linux without display (headless server)
  if (platform === "linux" && !process.env.DISPLAY) {
    return false;
  }
  return true;
}

/**
 * Initialize system tray with menu
 * @param {Object} options - { port, onQuit, onOpenDashboard }
 * @returns {Object|null} tray instance or null if not supported/failed
 */
function initTray(options) {
  // Check OS support first
  if (!isTraySupported()) {
    return null;
  }

  const { port, onQuit, onOpenDashboard } = options;

  try {
    const SysTray = require("systray").default;

    // Check if autostart is enabled
    let autostartEnabled = false;
    try {
      const { isAutoStartEnabled } = require("./autostart");
      autostartEnabled = isAutoStartEnabled();
    } catch (e) {}

    const isWin = process.platform === "win32";
    const menu = {
      icon: getIconBase64(),
      // macOS requires empty title; Windows uses title as the tray icon tooltip
      title: isWin ? `9Router - Port ${port}` : "",
      tooltip: `9Router - Port ${port}`,
      items: [
        {
          title: `9Router (Port ${port})`,
          tooltip: "Server is running",
          enabled: false
        },
        {
          title: "Open Dashboard",
          tooltip: "Open in browser",
          enabled: true
        },
        {
          title: autostartEnabled ? "✓ Auto-start Enabled" : "Enable Auto-start",
          tooltip: "Run on OS startup",
          enabled: true
        },
        {
          title: "Quit",
          tooltip: "Stop server and exit",
          enabled: true
        }
      ]
    };

    trayInstance = new SysTray({
      menu,
      debug: false,
      copyDir: true
    });

    // Menu item index: 0=status, 1=dashboard, 2=autostart, 3=quit
    const AUTOSTART_INDEX = 2;

    trayInstance.onClick((action) => {
      if (action.item.title === "Open Dashboard") {
        if (onOpenDashboard) {
          onOpenDashboard();
        } else {
          openBrowser(`http://localhost:${port}/dashboard`);
        }
      } else if (action.item.title === "✓ Auto-start Enabled") {
        // Disable autostart
        try {
          const { disableAutoStart } = require("./autostart");
          disableAutoStart();
          // Update menu item
          trayInstance.sendAction({
            type: "update-item",
            item: {
              title: "Enable Auto-start",
              tooltip: "Run on OS startup",
              enabled: true
            },
            seq_id: AUTOSTART_INDEX
          });
        } catch (e) {}
      } else if (action.item.title === "Enable Auto-start") {
        // Enable autostart
        try {
          const { enableAutoStart } = require("./autostart");
          enableAutoStart();
          // Update menu item
          trayInstance.sendAction({
            type: "update-item",
            item: {
              title: "✓ Auto-start Enabled",
              tooltip: "Run on OS startup",
              enabled: true
            },
            seq_id: AUTOSTART_INDEX
          });
        } catch (e) {}
      } else if (action.item.title === "Quit") {
        console.log("\n👋 Shutting down...");
        if (onQuit) {
          onQuit();
        }
        killTray();
        setTimeout(() => process.exit(0), 500);
      }
    });

    trayInstance.onReady(() => {
      // Tray ready - silent
    });

    trayInstance.onError((err) => {
      // Ignore errors during shutdown
    });

    return trayInstance;
  } catch (err) {
    // Silent fail - tray is optional, app continues without it
    return null;
  }
}

/**
 * Kill/close system tray gracefully
 */
function killTray() {
  const instance = trayInstance;
  trayInstance = null; // Set to null first to prevent error handlers
  
  if (instance) {
    try {
      // Kill with silent mode to avoid JSON parse errors
      instance.kill(true);
    } catch (e) {
      // Ignore kill errors - tray binary may already be dead
    }
  }
}

/**
 * Open browser
 */
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

  exec(cmd);
}

module.exports = {
  initTray,
  killTray
};
