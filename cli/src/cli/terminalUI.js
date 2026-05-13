const api = require("./api/client");
const { showMenuWithBack } = require("./utils/menuHelper");
const { showProvidersMenu } = require("./menus/providers");
const { showApiKeysMenu } = require("./menus/apiKeys");
const { showCombosMenu } = require("./menus/combos");
const { showSettingsMenu } = require("./menus/settings");
const { showCliToolsMenu } = require("./menus/cliTools");

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m"
};

/**
 * Build header content with endpoint and API keys
 * @param {number} port - Server port
 * @returns {Promise<string>} Header content string
 */
async function buildHeaderContent(port) {
  const [keysResult, tunnelResult] = await Promise.all([
    api.getApiKeys(),
    api.getTunnelStatus()
  ]);
  
  const keys = keysResult.success ? (keysResult.data.keys || []) : [];
  const tunnel = tunnelResult.success ? (tunnelResult.data || {}) : {};
  const tunnelEnabled = tunnel.enabled === true;
  
  const lines = [];
  
  if (tunnelEnabled && tunnel.publicUrl) {
    lines.push(`Endpoint: ${COLORS.green}${tunnel.publicUrl}/v1${COLORS.reset}`);
    lines.push(`Tunnel:   ${COLORS.green}ON${COLORS.reset} ${COLORS.dim}(${tunnel.shortId})${COLORS.reset}`);
  } else {
    lines.push(`Endpoint: http://localhost:${port}/v1`);
    lines.push(`Tunnel:   ${COLORS.red}OFF${COLORS.reset} ${COLORS.dim}(local only)${COLORS.reset}`);
  }
  
  if (keys.length === 0) {
    lines.push(`Key:      ${COLORS.dim}No API keys yet${COLORS.reset}`);
  } else {
    lines.push(`Key:      ${COLORS.cyan}${keys[0].key}${COLORS.reset}`);
    keys.slice(1).forEach(k => lines.push(`          ${COLORS.cyan}${k.key}${COLORS.reset}`));
  }
  
  return lines.join("\n");
}

/**
 * Start Terminal UI
 * @param {number} port - Server port number
 */
async function startTerminalUI(port) {
  // Configure API client
  api.configure({ port });
  
  const basePath = ["9Router"];
  
  // Main menu
  await showMenuWithBack({
    title: "📡 9Router Terminal UI",
    breadcrumb: basePath,
    headerContent: async () => await buildHeaderContent(port),
    refresh: async () => ({}), // Refresh header on each loop
    items: [
      {
        label: "Providers",
        action: async () => {
          await showProvidersMenu([...basePath, "Providers"]);
          return true; // Continue
        }
      },
      {
        label: "API Keys",
        action: async () => {
          await showApiKeysMenu(port, [...basePath, "API Keys"]);
          return true;
        }
      },
      {
        label: "Combos",
        action: async () => {
          await showCombosMenu([...basePath, "Combos"]);
          return true;
        }
      },
      {
        label: "CLI Tools",
        action: async () => {
          await showCliToolsMenu(port, [...basePath, "CLI Tools"]);
          return true;
        }
      },
      {
        label: "Settings",
        action: async () => {
          await showSettingsMenu([...basePath, "Settings"]);
          return true;
        }
      }
    ],
    backLabel: "← Back to Interface Menu"
  });
}

module.exports = { startTerminalUI };
