const path = require("path");
const fs = require("fs");
const os = require("os");
const api = require("../api/client");
const { confirm, pause } = require("../utils/input");
const { showStatus } = require("../utils/display");
const { showMenuWithBack } = require("../utils/menuHelper");

// ANSI colors
const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m"
};

const DEFAULT_PASSWORD = "123456";

// Resolve db.json path (matches app/src/lib/dataDir.js convention)
function getDbPath() {
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || "", "9router", "db.json")
    : path.join(os.homedir(), ".9router", "db.json");
}

/**
 * Show settings menu (tunnel + RTK + reset password)
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showSettingsMenu(breadcrumb = []) {
  await showMenuWithBack({
    title: "⚙️  Настройки",
    breadcrumb,
    headerContent: async (data) => {
      const lines = [];

      // Tunnel section
      const tunnel = data?.tunnel || {};
      if (tunnel.enabled && tunnel.publicUrl) {
        lines.push(`  Адрес:    ${COLORS.green}${tunnel.publicUrl}/v1${COLORS.reset}`);
        lines.push(`  Туннель:  ${COLORS.green}ВКЛ${COLORS.reset} ${COLORS.dim}(${tunnel.shortId})${COLORS.reset}`);
      } else {
        lines.push(`  Адрес:    http://localhost:20128/v1`);
        lines.push(`  Туннель:  ${COLORS.red}ВЫКЛ${COLORS.reset} ${COLORS.dim}(только локально)${COLORS.reset}`);
      }

      // RTK section
      const rtkOn = data?.settings?.rtkEnabled !== false;
      lines.push(`  RTK:      ${rtkOn ? `${COLORS.green}ВКЛ${COLORS.reset}` : `${COLORS.red}ВЫКЛ${COLORS.reset}`} ${COLORS.dim}(Сохранение токенов)${COLORS.reset}`);

      // Auth mode section
      const authMode = data?.settings?.authMode || "password";
      const authColor = authMode === "password" ? COLORS.green : COLORS.yellow;
      lines.push(`  Вход:     ${authColor}${authMode.toUpperCase()}${COLORS.reset} ${COLORS.dim}(режим входа)${COLORS.reset}`);

      return lines.join("\n");
    },
    refresh: async () => {
      const [tunnelRes, settingsRes] = await Promise.all([
        api.getTunnelStatus(),
        api.getSettings()
      ]);
      return {
        tunnel: tunnelRes.success ? (tunnelRes.data || {}) : {},
        settings: settingsRes.success ? (settingsRes.data || {}) : {}
      };
    },
    items: [
      {
        label: "Туннель ВКЛ",
        action: async () => { await enableTunnel(); return true; }
      },
      {
        label: "Туннель ВЫКЛ",
        action: async () => { await disableTunnel(); return true; }
      },
      {
        label: (d) => {
          const on = d?.settings?.rtkEnabled !== false;
          return `Сохранение токенов (RTK): ${on ? "ВКЛ" : "ВЫКЛ"} → переключить`;
        },
        action: async (d) => { await toggleRtk(d?.settings?.rtkEnabled !== false); return true; }
      },
      {
        label: "🔑 Сбросить пароль на стандартный",
        action: async () => { await resetPassword(); return true; }
      },
      {
        label: (d) => {
          const mode = d?.settings?.authMode || "password";
          return mode === "password" ? "🔓 Режим входа (уже password)" : `🔓 Сбросить режим входа на password (сейчас: ${mode})`;
        },
        action: async () => { await resetAuthMode(); return true; }
      }
    ]
  });
}

/**
 * Reset authMode to "password" via API. Used when OIDC is misconfigured
 * and user is locked out of dashboard. CLI bypasses auth via x-9r-cli-token.
 */
async function resetAuthMode() {
  const ok = await confirm("Сбросить режим входа на PASSWORD (отключить OIDC)?");
  if (!ok) {
    showStatus("Отменено", "info");
    await pause();
    return;
  }

  const result = await api.updateSettings({ authMode: "password" });
  if (result.success) {
    showStatus("Режим входа сброшен на password. OIDC отключён.", "success");
  } else {
    showStatus(`Ошибка: ${result.error}`, "error");
  }
  await pause();
}

/**
 * Enable tunnel via API
 */
async function enableTunnel() {
  showStatus("Создание туннеля...", "info");
  const result = await api.enableTunnel();

  if (result.success) {
    const { publicUrl, shortId, alreadyRunning } = result.data || {};
    if (alreadyRunning) {
      showStatus(`Туннель уже запущен: ${publicUrl}`, "success");
    } else {
      showStatus(`Туннель включён: ${publicUrl} (${shortId})`, "success");
    }
  } else {
    showStatus(`Ошибка: ${result.error}`, "error");
  }

  await pause();
}

/**
 * Disable tunnel via API
 */
async function disableTunnel() {
  const result = await api.disableTunnel();

  if (result.success) {
    showStatus("Туннель отключён", "success");
  } else {
    showStatus(`Ошибка: ${result.error}`, "error");
  }

  await pause();
}

/**
 * Toggle RTK (Token Saver) via API
 * @param {boolean} currentlyOn
 */
async function toggleRtk(currentlyOn) {
  const next = !currentlyOn;
  const result = await api.updateSettings({ rtkEnabled: next });
  if (result.success) {
    showStatus(`Сохранение токенов ${next ? "включено" : "отключено"}`, "success");
  } else {
    showStatus(`Ошибка: ${result.error}`, "error");
  }
  await pause();
}

/**
 * Reset dashboard password by clearing the hash in db.json (Phase B).
 * After reset, user can log in with the default password "123456".
 */
async function resetPassword() {
  const dbPath = getDbPath();

  if (!fs.existsSync(dbPath)) {
    showStatus(`db.json не найден в ${dbPath}`, "error");
    await pause();
    return;
  }

  const ok = await confirm(`Сбросить пароль панели управления на стандартный "${DEFAULT_PASSWORD}"?`);
  if (!ok) {
    showStatus("Отменено", "info");
    await pause();
    return;
  }

  try {
    const raw = fs.readFileSync(dbPath, "utf-8");
    const db = JSON.parse(raw);
    if (db.settings && Object.prototype.hasOwnProperty.call(db.settings, "password")) {
      delete db.settings.password;
    }
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
    showStatus(`Пароль сброшен. Стандартный: ${DEFAULT_PASSWORD}`, "success");
  } catch (err) {
    showStatus(`Ошибка сброса пароля: ${err.message}`, "error");
  }
  await pause();
}

module.exports = { showSettingsMenu };
