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

// Cached header (SWR): show last value instantly, refresh in background.
let cachedHeader = "";
let fetchingHeader = false;

function renderHeader(port, keys, tunnel) {
  const tunnelEnabled = tunnel && tunnel.enabled === true;
  const lines = [];
  if (tunnelEnabled && tunnel.publicUrl) {
    lines.push(`Адрес:    ${COLORS.green}${tunnel.publicUrl}/v1${COLORS.reset}`);
    lines.push(`Туннель:  ${COLORS.green}ВКЛ${COLORS.reset} ${COLORS.dim}(${tunnel.shortId})${COLORS.reset}`);
  } else {
    lines.push(`Адрес:    http://localhost:${port}/v1`);
    lines.push(`Туннель:  ${COLORS.red}ВЫКЛ${COLORS.reset} ${COLORS.dim}(только локально)${COLORS.reset}`);
  }
  if (!keys || keys.length === 0) {
    lines.push(`Ключ:     ${COLORS.dim}Ключи API не найдены${COLORS.reset}`);
  } else {
    lines.push(`Ключ:     ${COLORS.cyan}${keys[0].key}${COLORS.reset}`);
    keys.slice(1).forEach(k => { lines.push(`          ${COLORS.cyan}${k.key}${COLORS.reset}`); });
  }
  return lines.join("\n");
}

async function refreshHeaderBg(port) {
  if (fetchingHeader) return;
  fetchingHeader = true;
  try {
    const [keysResult, tunnelResult] = await Promise.all([
      api.getApiKeys(),
      api.getTunnelStatus()
    ]);
    const keys = keysResult.success ? (keysResult.data.keys || []) : [];
    const tunnel = tunnelResult.success ? (tunnelResult.data || {}) : {};
    cachedHeader = renderHeader(port, keys, tunnel);
  } finally {
    fetchingHeader = false;
  }
}

function getHeader(port) {
  // Kick off background refresh; return cache (or placeholder on first call).
  refreshHeaderBg(port);
  return cachedHeader || `Адрес:    http://localhost:${port}/v1\nТуннель:  ${COLORS.dim}...${COLORS.reset}\nКлюч:     ${COLORS.dim}...${COLORS.reset}`;
}

/**
 * Start Terminal UI
 * @param {number} port - Server port number
 */
async function startTerminalUI(port) {
  // Configure API client
  api.configure({ port });

  const basePath = ["9Router"];

  // Prime header cache before first render
  await refreshHeaderBg(port);

  // Main menu
  await showMenuWithBack({
    title: "📡 9Router Terminal UI",
    breadcrumb: basePath,
    headerContent: () => getHeader(port),
    items: [
      {
        label: "Провайдеры",
        action: async () => {
          await showProvidersMenu([...basePath, "Провайдеры"]);
          return true; // Continue
        }
      },
      {
        label: "Ключи API",
        action: async () => {
          await showApiKeysMenu(port, [...basePath, "Ключи API"]);
          return true;
        }
      },
      {
        label: "Комбинации",
        action: async () => {
          await showCombosMenu([...basePath, "Комбинации"]);
          return true;
        }
      },
      {
        label: "Инструменты CLI",
        action: async () => {
          await showCliToolsMenu(port, [...basePath, "Инструменты CLI"]);
          return true;
        }
      },
      {
        label: "Настройки",
        action: async () => {
          await showSettingsMenu([...basePath, "Настройки"]);
          return true;
        }
      }
    ],
    backLabel: "← Назад к меню выбора интерфейса"
  });
}

module.exports = { startTerminalUI };
