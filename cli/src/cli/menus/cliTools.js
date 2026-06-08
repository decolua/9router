const api = require("../api/client");
const { pause, confirm } = require("../utils/input");
const { showStatus } = require("../utils/display");
const { selectModelFromList } = require("../utils/modelSelector");
const { showMenuWithBack } = require("../utils/menuHelper");
const { getEndpoint } = require("../utils/endpoint");

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m"
};

// Claude model types with defaults (matching Web UI)
const CLAUDE_MODEL_TYPES = [
  { id: "sonnet", name: "Sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL", defaultValue: "cc/claude-sonnet-4-5-20250929" },
  { id: "opus",   name: "Opus",   envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL",   defaultValue: "cc/claude-opus-4-5-20251101" },
  { id: "haiku",  name: "Haiku",  envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL",  defaultValue: "cc/claude-haiku-4-5-20251001" },
];

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Get first available API key from server
 * @returns {Promise<string|null>}
 */
async function getFirstApiKey() {
  const result = await api.getApiKeys();
  const keys = result.success ? (result.data.keys || []) : [];
  return keys.length > 0 ? keys[0].key : null;
}

// ─── Claude Code ──────────────────────────────────────────────────────────────

/**
 * Build header showing current Claude config status
 * @returns {Promise<string>}
 */
async function buildClaudeHeader() {
  const result = await api.getCliToolSettings("claude");
  if (!result.success) return `  ${COLORS.red}Ошибка загрузки настроек${COLORS.reset}`;

  const settings = result.data.settings;
  const currentUrl = settings?.env?.ANTHROPIC_BASE_URL;
  const currentKey = settings?.env?.ANTHROPIC_AUTH_TOKEN;
  const lines = [];

  if (currentUrl) {
    lines.push(`Статус:   ${COLORS.green}✓ Настроено${COLORS.reset}`);
    lines.push(`Адрес:    ${COLORS.cyan}${currentUrl}${COLORS.reset}`);
    if (currentKey) {
      lines.push(`API ключ: ${COLORS.dim}${currentKey.substring(0, 10)}...${COLORS.reset}`);
    }
  } else {
    lines.push(`Статус:   ${COLORS.red}✗ Не настроено${COLORS.reset}`);
    lines.push(`${COLORS.dim}Запустите "Быструю настройку"${COLORS.reset}`);
  }

  return lines.join("\n");
}

/**
 * Get current Claude model from settings
 * @param {string} envKey
 * @returns {Promise<string>}
 */
async function getClaudeModel(envKey) {
  const result = await api.getCliToolSettings("claude");
  return result.success ? (result.data.settings?.env?.[envKey] || "Не задано") : "Не задано";
}

/**
 * Quick setup for Claude Code — sets endpoint, key, and all default models
 * @param {number} port
 */
async function claudeQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("Ключи API не найдены. Создайте ключ в меню Ключей API.", "error");
    await pause();
    return;
  }

  const env = { ANTHROPIC_BASE_URL: endpoint, ANTHROPIC_AUTH_TOKEN: apiKey, API_TIMEOUT_MS: "600000" };
  CLAUDE_MODEL_TYPES.forEach(t => { env[t.envKey] = t.defaultValue; });

  const result = await api.applyCliToolSettings("claude", { env });
  showStatus(result.success ? "Быстрая настройка выполнена!" : `Ошибка: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Select and save a specific Claude model type
 * @param {Object} modelType
 * @param {number} port
 */
async function claudeSelectModel(modelType, port) {
  const current = await getClaudeModel(modelType.envKey);
  const selected = await selectModelFromList(`Выберите модель ${modelType.name}`, current, { excludeCombos: true });
  if (!selected) return;

  const env = { [modelType.envKey]: selected };

  // Also set base URL if not configured yet
  const settingsResult = await api.getCliToolSettings("claude");
  if (!settingsResult.data?.settings?.env?.ANTHROPIC_BASE_URL) {
    const { endpoint } = await getEndpoint(port);
    const apiKey = await getFirstApiKey();
    env.ANTHROPIC_BASE_URL = endpoint;
    env.API_TIMEOUT_MS = "600000";
    if (apiKey) env.ANTHROPIC_AUTH_TOKEN = apiKey;
  }

  const result = await api.applyCliToolSettings("claude", { env });
  showStatus(result.success ? `${modelType.name} → ${selected} сохранено!` : `Ошибка: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Reset Claude Code settings
 */
async function claudeReset() {
  const result = await api.resetCliToolSettings("claude");
  showStatus(result.success ? "Настройки сброшены!" : `Ошибка: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Claude Code submenu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showClaudeCodeMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "🔧 Настройки Claude Code",
    breadcrumb,
    headerContent: buildClaudeHeader,
    refresh: async () => ({
      sonnet: await getClaudeModel("ANTHROPIC_DEFAULT_SONNET_MODEL"),
      opus:   await getClaudeModel("ANTHROPIC_DEFAULT_OPUS_MODEL"),
      haiku:  await getClaudeModel("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
    }),
    items: [
      {
        label: "⚡ Быстрая настройка (рекомендуется)",
        action: async () => { await claudeQuickSetup(port); return true; }
      },
      {
        label: (d) => `Sonnet → ${d.sonnet}`,
        action: async () => { await claudeSelectModel(CLAUDE_MODEL_TYPES[0], port); return true; }
      },
      {
        label: (d) => `Opus → ${d.opus}`,
        action: async () => { await claudeSelectModel(CLAUDE_MODEL_TYPES[1], port); return true; }
      },
      {
        label: (d) => `Haiku → ${d.haiku}`,
        action: async () => { await claudeSelectModel(CLAUDE_MODEL_TYPES[2], port); return true; }
      },
      {
        label: "Сбросить на стандартные",
        action: async () => { await claudeReset(); return true; }
      }
    ]
  });
}

// ─── Codex CLI ────────────────────────────────────────────────────────────────

/**
 * Build header showing current Codex config status
 * @returns {Promise<string>}
 */
async function buildCodexHeader() {
  const result = await api.getCliToolSettings("codex");
  if (!result.success) return `  ${COLORS.red}Ошибка загрузки настроек${COLORS.reset}`;

  const { installed, has9Router, config } = result.data;
  if (!installed) return `Статус:   ${COLORS.red}✗ Codex CLI не установлен${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Статус:   ${COLORS.red}✗ Не настроено${COLORS.reset}`,
      `${COLORS.dim}Запустите "Быструю настройку"${COLORS.reset}`
    ].join("\n");
  }

  // Parse base_url and model from raw TOML string
  const baseUrlMatch = config && config.match(/base_url\s*=\s*"([^"]+)"/);
  const modelMatch = config && config.match(/^model\s*=\s*"([^"]+)"/m);
  const baseUrl = baseUrlMatch ? baseUrlMatch[1] : "";
  const model = modelMatch ? modelMatch[1] : "";

  const lines = [`Статус:   ${COLORS.green}✓ Настроено${COLORS.reset}`];
  if (baseUrl) lines.push(`Адрес:    ${COLORS.cyan}${baseUrl}${COLORS.reset}`);
  if (model)   lines.push(`Модель:   ${COLORS.dim}${model}${COLORS.reset}`);
  return lines.join("\n");
}

/**
 * Quick setup for Codex CLI
 * @param {number} port
 */
async function codexQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("Ключи API не найдены. Создайте ключ в меню Ключей API.", "error");
    await pause();
    return;
  }

  // Get model selection
  const model = await selectModelFromList("Выберите модель Codex", "cx/claude-sonnet-4-5-20250929", { excludeCombos: true });
  if (!model) return;

  const result = await api.applyCliToolSettings("codex", { baseUrl: endpoint, apiKey, model });
  showStatus(result.success ? "Настройка Codex выполнена!" : `Ошибка: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Reset Codex CLI settings
 */
async function codexReset() {
  const result = await api.resetCliToolSettings("codex");
  showStatus(result.success ? "Настройки Codex сброшены!" : `Ошибка: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Codex CLI submenu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showCodexMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "🤖 Настройки Codex CLI",
    breadcrumb,
    headerContent: buildCodexHeader,
    refresh: async () => ({}),
    items: [
      {
        label: "⚡ Быстрая настройка",
        action: async () => { await codexQuickSetup(port); return true; }
      },
      {
        label: "Сбросить на стандартные",
        action: async () => { await codexReset(); return true; }
      }
    ]
  });
}

// ─── Factory Droid ────────────────────────────────────────────────────────────

/**
 * Build header showing current Droid config status
 * @returns {Promise<string>}
 */
async function buildDroidHeader() {
  const result = await api.getCliToolSettings("droid");
  if (!result.success) return `  ${COLORS.red}Ошибка загрузки настроек${COLORS.reset}`;

  const { installed, has9Router, settings } = result.data;
  if (!installed) return `Статус:   ${COLORS.red}✗ Factory Droid не установлен${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Статус:   ${COLORS.red}✗ Не настроено${COLORS.reset}`,
      `${COLORS.dim}Запустите "Быструю настройку"${COLORS.reset}`
    ].join("\n");
  }

  // Extract 9Router custom model config
  const custom = settings?.customModels?.find(m => m.id === "custom:9Router-0");
  const lines = [`Статус:   ${COLORS.green}✓ Настроено${COLORS.reset}`];
  if (custom?.baseUrl) lines.push(`Адрес:    ${COLORS.cyan}${custom.baseUrl}${COLORS.reset}`);
  if (custom?.model)   lines.push(`Модель:   ${COLORS.dim}${custom.model}${COLORS.reset}`);
  return lines.join("\n");
}

/**
 * Quick setup for Factory Droid
 * @param {number} port
 */
async function droidQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("Ключи API не найдены. Создайте ключ в меню Ключей API.", "error");
    await pause();
    return;
  }

  const model = await selectModelFromList("Выберите модель Droid", "cc/claude-sonnet-4-5-20250929", { excludeCombos: true });
  if (!model) return;

  const result = await api.applyCliToolSettings("droid", { baseUrl: endpoint, apiKey, model });
  showStatus(result.success ? "Настройка Factory Droid выполнена!" : `Ошибка: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Reset Factory Droid settings
 */
async function droidReset() {
  const result = await api.resetCliToolSettings("droid");
  showStatus(result.success ? "Настройки Factory Droid сброшены!" : `Ошибка: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Factory Droid submenu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showDroidMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "🤖 Настройки Factory Droid",
    breadcrumb,
    headerContent: buildDroidHeader,
    refresh: async () => ({}),
    items: [
      {
        label: "⚡ Быстрая настройка",
        action: async () => { await droidQuickSetup(port); return true; }
      },
      {
        label: "Сбросить на стандартные",
        action: async () => { await droidReset(); return true; }
      }
    ]
  });
}

// ─── Open Claw ────────────────────────────────────────────────────────────────

/**
 * Build header showing current OpenClaw config status
 * @returns {Promise<string>}
 */
async function buildOpenClawHeader() {
  const result = await api.getCliToolSettings("openclaw");
  if (!result.success) return `  ${COLORS.red}Ошибка загрузки настроек${COLORS.reset}`;

  const { installed, has9Router, settings } = result.data;
  if (!installed) return `Статус:   ${COLORS.red}✗ Open Claw не установлен${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Статус:   ${COLORS.red}✗ Не настроено${COLORS.reset}`,
      `${COLORS.dim}Запустите "Быструю настройку"${COLORS.reset}`
    ].join("\n");
  }

  // Extract 9Router provider config
  const provider = settings?.models?.providers?.["9router"];
  const primary = settings?.agents?.defaults?.model?.primary || "";
  const model = primary.startsWith("9router/") ? primary.replace("9router/", "") : (provider?.models?.[0]?.id || "");
  const lines = [`Статус:   ${COLORS.green}✓ Настроено${COLORS.reset}`];
  if (provider?.baseUrl) lines.push(`Адрес:    ${COLORS.cyan}${provider.baseUrl}${COLORS.reset}`);
  if (model)             lines.push(`Модель:   ${COLORS.dim}${model}${COLORS.reset}`);
  return lines.join("\n");
}

/**
 * Quick setup for Open Claw
 * @param {number} port
 */
async function openClawQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("Ключи API не найдены. Создайте ключ в меню Ключей API.", "error");
    await pause();
    return;
  }

  const model = await selectModelFromList("Выберите модель OpenClaw", "cc/claude-sonnet-4-5-20250929", { excludeCombos: true });
  if (!model) return;

  const result = await api.applyCliToolSettings("openclaw", { baseUrl: endpoint, apiKey, model });
  showStatus(result.success ? "Настройка Open Claw выполнена!" : `Ошибка: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Reset Open Claw settings
 */
async function openClawReset() {
  const result = await api.resetCliToolSettings("openclaw");
  showStatus(result.success ? "Настройки Open Claw сброшены!" : `Ошибка: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

/**
 * Open Claw submenu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showOpenClawMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "🦞 Настройки Open Claw",
    breadcrumb,
    headerContent: buildOpenClawHeader,
    refresh: async () => ({}),
    items: [
      {
        label: "⚡ Быстрая настройка",
        action: async () => { await openClawQuickSetup(port); return true; }
      },
      {
        label: "Сбросить на стандартные",
        action: async () => { await openClawReset(); return true; }
      }
    ]
  });
}

// ─── OpenCode CLI ─────────────────────────────────────────────────────────────

async function buildOpenCodeHeader() {
  const result = await api.getCliToolSettings("opencode");
  if (!result.success) return `  ${COLORS.red}Ошибка загрузки настроек${COLORS.reset}`;

  const { installed, has9Router, opencode } = result.data;
  if (!installed) return `Статус:   ${COLORS.red}✗ OpenCode CLI не установлен${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Статус:   ${COLORS.red}✗ Не настроено${COLORS.reset}`,
      `${COLORS.dim}Запустите "Быструю настройку"${COLORS.reset}`
    ].join("\n");
  }

  const lines = [`Статус:   ${COLORS.green}✓ Настроено${COLORS.reset}`];
  if (opencode?.baseURL) lines.push(`Адрес:    ${COLORS.cyan}${opencode.baseURL}${COLORS.reset}`);
  if (opencode?.activeModel) lines.push(`Активна:  ${COLORS.dim}${opencode.activeModel}${COLORS.reset}`);
  if (Array.isArray(opencode?.models) && opencode.models.length > 0) {
    lines.push(`Модели:   ${COLORS.dim}${opencode.models.join(", ")}${COLORS.reset}`);
  }
  return lines.join("\n");
}

async function openCodeQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("Ключи API не найдены. Создайте ключ в меню Ключей API.", "error");
    await pause();
    return;
  }

  // Pick first model (also becomes active model by default)
  const firstModel = await selectModelFromList("Выберите активную модель (OpenCode)", "", { excludeCombos: true });
  if (!firstModel) return;

  const models = [firstModel];

  // Optionally add more models
  while (true) {
    const more = await confirm(`Добавить ещё модель? (сейчас: ${models.length})`);
    if (!more) break;
    const next = await selectModelFromList(`Добавить модель #${models.length + 1}`, models.join(", "), { excludeCombos: true });
    if (!next) break;
    if (!models.includes(next)) models.push(next);
  }

  // Optional subagent model
  let subagentModel = firstModel;
  const wantSubagent = await confirm(`Установить другую модель сабагента? (по умолчанию: ${firstModel})`);
  if (wantSubagent) {
    const picked = await selectModelFromList("Выберите модель сабагента", firstModel, { excludeCombos: true });
    if (picked) subagentModel = picked;
  }

  const result = await api.applyCliToolSettings("opencode", {
    baseUrl: endpoint,
    apiKey,
    models,
    activeModel: firstModel,
    subagentModel,
  });
  showStatus(result.success ? "Настройка OpenCode выполнена!" : `Ошибка: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

async function openCodeReset() {
  const result = await api.resetCliToolSettings("opencode");
  showStatus(result.success ? "Настройки OpenCode сброшены!" : `Ошибка: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

async function showOpenCodeMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "💻 Настройки OpenCode CLI",
    breadcrumb,
    headerContent: buildOpenCodeHeader,
    refresh: async () => ({}),
    items: [
      { label: "⚡ Быстрая настройка", action: async () => { await openCodeQuickSetup(port); return true; } },
      { label: "Сбросить на стандартные", action: async () => { await openCodeReset(); return true; } }
    ]
  });
}

// ─── Hermes Agent ─────────────────────────────────────────────────────────────

async function buildHermesHeader() {
  const result = await api.getCliToolSettings("hermes");
  if (!result.success) return `  ${COLORS.red}Ошибка загрузки настроек${COLORS.reset}`;

  const { installed, has9Router, settings } = result.data;
  if (!installed) return `Статус:   ${COLORS.red}✗ Hermes Agent не установлен${COLORS.reset}`;

  if (!has9Router) {
    return [
      `Статус:   ${COLORS.red}✗ Не настроено${COLORS.reset}`,
      `${COLORS.dim}Запустите "Быструю настройку"${COLORS.reset}`
    ].join("\n");
  }

  const model = settings?.model || {};
  const lines = [`Статус:   ${COLORS.green}✓ Настроено${COLORS.reset}`];
  if (model.base_url) lines.push(`Адрес:    ${COLORS.cyan}${model.base_url}${COLORS.reset}`);
  if (model.default)  lines.push(`Модель:   ${COLORS.dim}${model.default}${COLORS.reset}`);
  return lines.join("\n");
}

async function hermesQuickSetup(port) {
  const { endpoint } = await getEndpoint(port);
  const apiKey = await getFirstApiKey();

  if (!apiKey) {
    showStatus("Ключи API не найдены. Создайте ключ в меню Ключей API.", "error");
    await pause();
    return;
  }

  const model = await selectModelFromList("Выберите модель Hermes", "", { excludeCombos: true });
  if (!model) return;

  const result = await api.applyCliToolSettings("hermes", { baseUrl: endpoint, apiKey, model });
  showStatus(result.success ? "Настройка Hermes выполнена!" : `Ошибка: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

async function hermesReset() {
  const result = await api.resetCliToolSettings("hermes");
  showStatus(result.success ? "Настройки Hermes сброшены!" : `Ошибка: ${result.error}`, result.success ? "success" : "error");
  await pause();
}

async function showHermesMenu(port, breadcrumb = []) {
  await showMenuWithBack({
    title: "⚡ Настройки Hermes Agent",
    breadcrumb,
    headerContent: buildHermesHeader,
    refresh: async () => ({}),
    items: [
      { label: "⚡ Быстрая настройка", action: async () => { await hermesQuickSetup(port); return true; } },
      { label: "Сбросить на стандартные", action: async () => { await hermesReset(); return true; } }
    ]
  });
}

// ─── Main CLI Tools Menu ──────────────────────────────────────────────────────

/**
 * Main CLI Tools menu
 * @param {number} port
 * @param {Array<string>} breadcrumb
 */
async function showCliToolsMenu(port, breadcrumb = []) {
  const { endpoint } = await getEndpoint(port);
  await showMenuWithBack({
    title: "🔧 Инструменты CLI",
    breadcrumb,
    headerContent: `Настройка CLI инструментов для работы с 9Router\nАдрес: ${endpoint}`,
    items: [
      {
        label: "Claude Code",
        action: async () => { await showClaudeCodeMenu(port, [...breadcrumb, "Claude Code"]); return true; }
      },
      {
        label: "Codex CLI",
        action: async () => { await showCodexMenu(port, [...breadcrumb, "Codex CLI"]); return true; }
      },
      {
        label: "Factory Droid",
        action: async () => { await showDroidMenu(port, [...breadcrumb, "Factory Droid"]); return true; }
      },
      {
        label: "Open Claw",
        action: async () => { await showOpenClawMenu(port, [...breadcrumb, "Open Claw"]); return true; }
      },
      {
        label: "OpenCode",
        action: async () => { await showOpenCodeMenu(port, [...breadcrumb, "OpenCode"]); return true; }
      },
      {
        label: "Hermes",
        action: async () => { await showHermesMenu(port, [...breadcrumb, "Hermes"]); return true; }
      }
    ]
  });
}

module.exports = { showCliToolsMenu };
