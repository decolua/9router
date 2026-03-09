const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");
const api = require("../api/client");

let trayInstance = null;
let updateInterval = null;
let latestVersion = null;
let currentPort = null; // Store port for refresh
let quotaCache = null; // Cache quota data
let quotaCacheTime = 0; // Last quota fetch timestamp
const QUOTA_CACHE_TTL = 60000; // Cache quota for 60 seconds

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
 * Check for npm package updates
 */
async function checkForUpdates() {
  return new Promise((resolve) => {
    try {
      const pkg = require("../../../package.json");
      const req = https.get(`https://registry.npmjs.org/${pkg.name}/latest`, { timeout: 3000 }, (res) => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            const latest = JSON.parse(data);
            if (latest.version && latest.version !== pkg.version) {
              resolve(latest.version);
            } else {
              resolve(null);
            }
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.on("error", () => resolve(null));
      req.on("timeout", () => { req.destroy(); resolve(null); });
    } catch (e) {
      resolve(null);
    }
  });
}

/**
 * Format time ago (e.g., "2m ago", "1h ago")
 */
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}

/**
 * Get data directory path based on platform
 */
function getDataDir() {
  const platform = process.platform;
  const homeDir = require("os").homedir();

  if (platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "9router-fdk");
  } else {
    return path.join(homeDir, ".9router-fdk");
  }
}

/**
 * Parse latest request from log.txt
 * Format: Date Time | Model | Connection-ID | Provider-Name | Input-Tokens | Output-Tokens | Status
 */
function parseLatestLog() {
  try {
    const logPath = path.join(getDataDir(), "log.txt");
    if (!fs.existsSync(logPath)) {
      return null;
    }

    const logContent = fs.readFileSync(logPath, "utf8");
    const lines = logContent.trim().split("\n").filter(l => l.trim());

    // Find last completed request (200 OK status)
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes("200 OK")) continue;

      const parts = line.split("|").map(p => p.trim());
      if (parts.length < 7) continue;

      const [datetime, model, connectionId, providerName, tokensIn, tokensOut, status] = parts;

      // Parse timestamp
      const timestamp = new Date(datetime.replace(/(\d{2})-(\d{2})-(\d{4})/, "$3-$2-$1"));

      return {
        model,
        provider: providerName,
        connectionId,
        tokensIn: parseInt(tokensIn) || 0,
        tokensOut: parseInt(tokensOut) || 0,
        timestamp: timestamp.toISOString()
      };
    }

    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Get current model and usage info from server
 */
async function getServerInfo(port) {
  try {
    // Parse latest log from log.txt
    const latestLog = parseLatestLog();

    let modelInfo = "No requests yet";
    let contextInfo = "N/A";
    let lastProvider = null;

    if (latestLog) {
      // Model: ProviderName/ModelName
      modelInfo = `${latestLog.provider}/${latestLog.model}`;
      lastProvider = latestLog.provider;

      // Context: in/out tokens + time ago
      const timeAgo = formatTimeAgo(latestLog.timestamp);
      contextInfo = `${latestLog.tokensIn}/${latestLog.tokensOut} (${timeAgo})`;
    }

    // Quota Tracker: Use cache or fetch new data
    let quotaInfo = "Loading...";
    const now = Date.now();
    const shouldRefreshQuota = !quotaCache || (now - quotaCacheTime) > QUOTA_CACHE_TTL;

    if (shouldRefreshQuota) {
      // Fetch fresh quota data
      const providersResult = await api.getProviders();
      const allProviders = providersResult.success ? (providersResult.data?.connections || []) : [];

      // Filter only active providers
      const providers = allProviders.filter(p => p.isActive !== false);

      if (providers.length > 0) {
        const quotaPromises = providers.map(async (conn) => {
          try {
            const response = await fetch(`http://localhost:${port}/api/usage/${conn.id}`);
            if (!response.ok) {
              return null;
            }
            const data = await response.json();

            // Parse quota based on provider
            // data.quotas can be either an object {tokens: {...}} or array [{...}]
            let quotaArray = [];
            if (data.quotas) {
              if (Array.isArray(data.quotas)) {
                quotaArray = data.quotas;
              } else if (typeof data.quotas === 'object') {
                // Convert object to array (e.g., {tokens: {...}} -> [{...}])
                quotaArray = Object.values(data.quotas);
              }
            }

            if (quotaArray.length > 0) {
              const quota = quotaArray[0];
              const providerName = conn.name || conn.provider;

              // Check if this provider matches lastProvider (case-insensitive partial match)
              const isLastUsed = lastProvider && (
                providerName.toLowerCase().includes(lastProvider.toLowerCase()) ||
                lastProvider.toLowerCase().includes(providerName.toLowerCase())
              );

              // Calculate percentage from used/total
              const used = quota.used || 0;
              const total = quota.total || 0;
              const percentage = total > 0 ? Math.round(((total - used) / total) * 100) : 0;

              // Parse USD values if available (for Ramclouds)
              const usedUSD = quota.usedUSD || null;
              const totalUSD = quota.totalUSD || null;

              return {
                provider: providerName,
                used,
                limit: total,
                percentage,
                usedUSD,
                totalUSD,
                isLastUsed
              };
            }
            return null;
          } catch (e) {
            return null;
          }
        });

        const quotas = (await Promise.all(quotaPromises)).filter(q => q !== null);

        if (quotas.length > 0) {
          // Prioritize showing quota of last used provider
          const lastUsedQuota = quotas.find(q => q.isLastUsed);
          const selectedQuota = lastUsedQuota || quotas.reduce((max, q) => q.percentage > max.percentage ? q : max);

          // Format quota display
          if (selectedQuota.usedUSD && selectedQuota.totalUSD) {
            // Show USD format for providers that support it (e.g., Ramclouds)
            quotaInfo = `${selectedQuota.provider}: ${selectedQuota.percentage}% (used $${selectedQuota.usedUSD} / $${selectedQuota.totalUSD})`;
          } else {
            // Show percentage only for other providers
            quotaInfo = `${selectedQuota.provider}: ${selectedQuota.percentage}%`;
          }
        } else {
          quotaInfo = `${providers.length} provider(s)`;
        }
      } else {
        quotaInfo = "No providers";
      }

      // Update cache
      quotaCache = quotaInfo;
      quotaCacheTime = now;
    } else {
      // Use cached data
      quotaInfo = quotaCache;
    }

    return {
      model: modelInfo,
      context: contextInfo,
      quota: quotaInfo
    };
  } catch (err) {
    return {
      model: "Unknown",
      context: "N/A",
      quota: "N/A"
    };
  }
}

/**
 * Update tray menu with latest info
 */
async function updateTrayMenu(port) {
  if (!trayInstance) return;

  try {
    const serverInfo = await getServerInfo(port);

    // Update info items (indices 2, 3, 4 for model, context, quota)
    trayInstance.sendAction({
      type: "update-item",
      item: {
        title: `Model: ${serverInfo.model}`,
        tooltip: "Latest request model",
        enabled: true
      },
      seq_id: 2
    });

    trayInstance.sendAction({
      type: "update-item",
      item: {
        title: `Context: ${serverInfo.context}`,
        tooltip: "Latest request tokens (in/out)",
        enabled: true
      },
      seq_id: 3
    });

    trayInstance.sendAction({
      type: "update-item",
      item: {
        title: `Quota: ${serverInfo.quota}`,
        tooltip: "Provider quota usage",
        enabled: true
      },
      seq_id: 4
    });
  } catch (err) {
    // Silent fail - tray update is optional
  }
}

/**
 * Initialize system tray with menu
 * @param {Object} options - { port, onQuit, onOpenDashboard }
 * @returns {Object|null} tray instance or null if not supported/failed
 */
async function initTray(options) {
  // Check OS support first
  if (!isTraySupported()) {
    return null;
  }

  const { port, onQuit, onOpenDashboard } = options;

  try {
    const SysTray = require("systray").default;

    // Configure API client
    api.configure({ port });

    // Check if autostart is enabled
    let autostartEnabled = false;
    try {
      const { isAutoStartEnabled } = require("./autostart");
      autostartEnabled = isAutoStartEnabled();
    } catch (e) {}

    // Get initial server info
    const serverInfo = await getServerInfo(port);

    // Check for updates
    const newVersion = await checkForUpdates();
    const updateTitle = newVersion ? `New release: ${newVersion}` : "Check Update";

    const isWin = process.platform === "win32";
    const menu = {
      icon: getIconBase64(),
      title: isWin ? `9Router FDK - Port ${port}` : "",
      tooltip: `9Router FDK - Port ${port}`,
      items: [
        {
          title: `9Router FDK (Port ${port})`,
          tooltip: "Server is running",
          enabled: false
        },
        {
          title: "─────────────────",
          tooltip: "",
          enabled: false
        },
        {
          title: `Model: ${serverInfo.model}`,
          tooltip: "Latest request model",
          enabled: true
        },
        {
          title: `Context: ${serverInfo.context}`,
          tooltip: "Latest request tokens (in/out)",
          enabled: true
        },
        {
          title: `Quota: ${serverInfo.quota}`,
          tooltip: "Provider quota usage",
          enabled: true
        },
        {
          title: "─────────────────",
          tooltip: "",
          enabled: false
        },
        {
          title: "Open Dashboard",
          tooltip: "Open in browser",
          enabled: true
        },
        {
          title: updateTitle,
          tooltip: newVersion ? "New version available" : "Check for updates",
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

    // Menu item indices
    const MENU_INDICES = {
      MODEL: 2,
      CONTEXT: 3,
      QUOTA: 4,
      DASHBOARD: 6,
      CHECK_UPDATE: 7,
      AUTOSTART: 8,
      QUIT: 9
    };

    trayInstance.onClick(async (action) => {
      const title = action.item.title;

      if (title === "Open Dashboard") {
        if (onOpenDashboard) {
          onOpenDashboard();
        } else {
          openBrowser(`http://localhost:${port}/dashboard`);
        }
      }
      // Check for updates - open npm package page
      else if (title === "Check Update" || title.startsWith("New release:")) {
        // Open npm package page in browser
        openBrowser("https://www.npmjs.com/package/9router-fdk");

        // Also check for updates and update menu
        const newVersion = await checkForUpdates();
        if (newVersion) {
          trayInstance.sendAction({
            type: "update-item",
            item: {
              title: `New release: ${newVersion}`,
              tooltip: "Click to view on npm",
              enabled: true
            },
            seq_id: MENU_INDICES.CHECK_UPDATE
          });
        } else {
          trayInstance.sendAction({
            type: "update-item",
            item: {
              title: "Check Update",
              tooltip: "Click to view on npm",
              enabled: true
            },
            seq_id: MENU_INDICES.CHECK_UPDATE
          });
        }
      }
      // Auto-start toggle
      else if (title === "✓ Auto-start Enabled") {
        try {
          const { disableAutoStart } = require("./autostart");
          disableAutoStart();
          trayInstance.sendAction({
            type: "update-item",
            item: {
              title: "Enable Auto-start",
              tooltip: "Run on OS startup",
              enabled: true
            },
            seq_id: MENU_INDICES.AUTOSTART
          });
        } catch (e) {}
      } else if (title === "Enable Auto-start") {
        try {
          const { enableAutoStart } = require("./autostart");
          enableAutoStart();
          trayInstance.sendAction({
            type: "update-item",
            item: {
              title: "✓ Auto-start Enabled",
              tooltip: "Run on OS startup",
              enabled: true
            },
            seq_id: MENU_INDICES.AUTOSTART
          });
        } catch (e) {}
      }
      // Quit
      else if (title === "Quit") {
        console.log("\n👋 Shutting down...");
        if (onQuit) {
          onQuit();
        }
        killTray();
        setTimeout(() => process.exit(0), 500);
      }
    });

    trayInstance.onReady(() => {
      // Store port for refresh
      currentPort = port;

      // Tray ready - start auto-update interval (1 second)
      updateInterval = setInterval(() => {
        updateTrayMenu(currentPort);
      }, 1000);
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
  // Clear update interval
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }

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
