const path = require("path");
const fs = require("fs");
const os = require("os");
const api = require("../api/client");
const { getRuntimeNodeModules } = require("../../../hooks/sqliteRuntime");
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

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  return process.platform === "win32"
    ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router")
    : path.join(os.homedir(), ".9router");
}

// Legacy lowdb path kept only as a fallback for pre-SQLite installs.
function getLegacyDbPath() {
  return path.join(getDataDir(), "db.json");
}

function getSqliteDbPath() {
  return path.join(getDataDir(), "db", "data.sqlite");
}

function loadBetterSqlite() {
  try {
    return require("better-sqlite3");
  } catch {}
  try {
    return require(path.join(getRuntimeNodeModules(), "better-sqlite3"));
  } catch {
    return null;
  }
}

function loadNodeSqlite() {
  try {
    return require("node:sqlite").DatabaseSync;
  } catch {
    return null;
  }
}

function openOfflineSqliteDb(dbPath) {
  const BetterSqlite = loadBetterSqlite();
  if (BetterSqlite) return new BetterSqlite(dbPath);

  const NodeSqlite = loadNodeSqlite();
  if (NodeSqlite) return new NodeSqlite(dbPath);

  return null;
}

function resetPasswordInSqlite() {
  const dbPath = getSqliteDbPath();
  if (!fs.existsSync(dbPath)) return { success: false, error: `SQLite DB not found at ${dbPath}` };

  let db;
  try {
    db = openOfflineSqliteDb(dbPath);
    if (!db) {
      return { success: false, error: "No offline SQLite driver available (better-sqlite3 or node:sqlite)" };
    }
    const row = db.prepare("SELECT data FROM settings WHERE id = 1").get();
    const settings = row?.data ? JSON.parse(row.data) : {};
    // Offline recovery for #1482: no server is available to call /api/settings,
    // so edit the same JSON payload the SQLite-backed settings repo stores.
    delete settings.password;
    settings.authMode = "password";
    db.prepare(
      "INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data"
    ).run(JSON.stringify(settings));
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    try { db?.close?.(); } catch {}
  }
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

      // Auth mode section
      const authMode = data?.settings?.authMode || "password";
      const authColor = authMode === "password" ? COLORS.green : COLORS.yellow;
      lines.push(`  Auth:     ${authColor}${authMode.toUpperCase()}${COLORS.reset} ${COLORS.dim}(login mode)${COLORS.reset}`);

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
      },
      {
        label: (d) => {
          const mode = d?.settings?.authMode || "password";
          return mode === "password" ? "🔓 Reset Auth Mode (already password)" : `🔓 Reset Auth Mode to Password (current: ${mode})`;
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
  const ok = await confirm("Reset auth mode to PASSWORD (disable OIDC)?");
  if (!ok) {
    showStatus("Cancelled", "info");
    await pause();
    return;
  }

  const result = await api.updateSettings({ authMode: "password" });
  if (result.success) {
    showStatus("Auth mode reset to password. OIDC disabled.", "success");
  } else {
    showStatus(`Failed: ${result.error}`, "error");
  }
  await pause();
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
 * Reset dashboard password through the app API so SQLite-backed installs are updated.
 * Falls back to offline SQLite and then legacy db.json when the server/API is unavailable.
 * Fixes #1482: the previous reset edited db.json after the app had migrated to SQLite.
 */
async function resetPassword() {
  const ok = await confirm(`Reset dashboard password to default "${DEFAULT_PASSWORD}"?`);
  if (!ok) {
    showStatus("Cancelled", "info");
    await pause();
    return;
  }

  const result = await api.updateSettings({ password: null, authMode: "password" });
  if (result.success) {
    showStatus(`Password reset. Default: ${DEFAULT_PASSWORD}`, "success");
    await pause();
    return;
  }

  const sqliteResult = resetPasswordInSqlite();
  if (sqliteResult.success) {
    showStatus(`Password reset offline. Default: ${DEFAULT_PASSWORD}`, "success");
    await pause();
    return;
  }

  try {
    const dbPath = getLegacyDbPath();
    if (!fs.existsSync(dbPath)) {
      showStatus(`Failed: ${result.error}; ${sqliteResult.error}. Legacy db.json not found at ${dbPath}`, "error");
      await pause();
      return;
    }

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
