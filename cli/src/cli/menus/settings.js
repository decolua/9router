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
    title: "⚙️  Settings",
    breadcrumb,
    headerContent: async (data) => {
      const lines = [];

      // Tunnel section
      const tunnel = data?.tunnel || {};
      if (tunnel.enabled && tunnel.publicUrl) {
        lines.push(`  Endpoint: ${COLORS.green}${tunnel.publicUrl}/v1${COLORS.reset}`);
        lines.push(`  Tunnel:   ${COLORS.green}ON${COLORS.reset} ${COLORS.dim}(${tunnel.shortId})${COLORS.reset}`);
      } else {
        lines.push(`  Endpoint: http://localhost:20128/v1`);
        lines.push(`  Tunnel:   ${COLORS.red}OFF${COLORS.reset} ${COLORS.dim}(local only)${COLORS.reset}`);
      }

      // RTK section
      const rtkOn = data?.settings?.rtkEnabled !== false;
      lines.push(`  RTK:      ${rtkOn ? `${COLORS.green}ON${COLORS.reset}` : `${COLORS.red}OFF${COLORS.reset}`} ${COLORS.dim}(Token Saver)${COLORS.reset}`);

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
        label: "Tunnel ON",
        action: async () => { await enableTunnel(); return true; }
      },
      {
        label: "Tunnel OFF",
        action: async () => { await disableTunnel(); return true; }
      },
      {
        label: (d) => {
          const on = d?.settings?.rtkEnabled !== false;
          return `Token Saver (RTK): ${on ? "ON" : "OFF"} → toggle`;
        },
        action: async (d) => { await toggleRtk(d?.settings?.rtkEnabled !== false); return true; }
      },
      {
        label: "🔑 Reset Password to Default",
        action: async () => { await resetPassword(); return true; }
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
    const { publicUrl, shortId, alreadyRunning } = result.data || {};
    if (alreadyRunning) {
      showStatus(`Tunnel already running: ${publicUrl}`, "success");
    } else {
      showStatus(`Tunnel enabled: ${publicUrl} (${shortId})`, "success");
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

/**
 * Toggle RTK (Token Saver) via API
 * @param {boolean} currentlyOn
 */
async function toggleRtk(currentlyOn) {
  const next = !currentlyOn;
  const result = await api.updateSettings({ rtkEnabled: next });
  if (result.success) {
    showStatus(`Token Saver ${next ? "enabled" : "disabled"}`, "success");
  } else {
    showStatus(`Failed: ${result.error}`, "error");
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
    showStatus(`db.json not found at ${dbPath}`, "error");
    await pause();
    return;
  }

  const ok = await confirm(`Reset dashboard password to default "${DEFAULT_PASSWORD}"?`);
  if (!ok) {
    showStatus("Cancelled", "info");
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
    showStatus(`Password reset. Default: ${DEFAULT_PASSWORD}`, "success");
  } catch (err) {
    showStatus(`Failed to reset password: ${err.message}`, "error");
  }
  await pause();
}

module.exports = { showSettingsMenu };
