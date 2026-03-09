const api = require("../api/client");
const { pause } = require("../utils/input");
const { showStatus } = require("../utils/display");
const { showMenuWithBack } = require("../utils/menuHelper");

// ANSI colors
const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m"
};

/**
 * Show settings menu (tunnel controls)
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showSettingsMenu(breadcrumb = []) {
  await showMenuWithBack({
    title: "⚙️  Settings",
    breadcrumb,
    headerContent: async () => {
      const result = await api.getTunnelStatus();
      if (!result.success) return "  Failed to load tunnel status";
      
      const { enabled, tunnelUrl, shortId } = result.data || {};
      
      if (enabled && tunnelUrl) {
        return [
          `  Endpoint: ${COLORS.green}${tunnelUrl}/v1${COLORS.reset}`,
          `  Tunnel:   ${COLORS.green}ON${COLORS.reset} ${COLORS.dim}(${shortId})${COLORS.reset}`
        ].join("\n");
      } else {
        return [
          `  Endpoint: http://localhost:20128/v1`,
          `  Tunnel:   ${COLORS.red}OFF${COLORS.reset} ${COLORS.dim}(local only)${COLORS.reset}`
        ].join("\n");
      }
    },
    refresh: async () => ({}),
    items: [
      {
        label: "Tunnel ON",
        action: async () => {
          await enableTunnel();
          return true;
        }
      },
      {
        label: "Tunnel OFF",
        action: async () => {
          await disableTunnel();
          return true;
        }
      }
    ]
  });
}

/**
 * Enable tunnel via API
 */
async function enableTunnel() {
  showStatus("Creating tunnel...", "info");
  const result = await api.enableTunnel();
  
  if (result.success) {
    const { tunnelUrl, shortId, alreadyRunning } = result.data || {};
    if (alreadyRunning) {
      showStatus(`Tunnel already running: ${tunnelUrl}`, "success");
    } else {
      showStatus(`Tunnel enabled: ${tunnelUrl} (${shortId})`, "success");
    }
  } else {
    showStatus(`Failed: ${result.error}`, "error");
  }
  
  await pause();
}

/**
 * Disable tunnel via API
 */
async function disableTunnel() {
  const result = await api.disableTunnel();
  
  if (result.success) {
    showStatus("Tunnel disabled", "success");
  } else {
    showStatus(`Failed: ${result.error}`, "error");
  }
  
  await pause();
}

module.exports = { showSettingsMenu };
