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
  dim: "\x1b[2m"
};

const DEFAULT_PASSWORD = "123456";

/**
 * Show settings menu (RTK + reset password)
 * @param {Array<string>} breadcrumb - Breadcrumb path
 */
async function showSettingsMenu(breadcrumb = []) {
  await showMenuWithBack({
    title: "⚙️  Settings",
    breadcrumb,
    headerContent: async (data) => {
      const lines = [];

      // RTK section
      const rtkOn = data?.settings?.rtkEnabled !== false;
      lines.push(`  RTK:      ${rtkOn ? `${COLORS.green}ON${COLORS.reset}` : `${COLORS.red}OFF${COLORS.reset}`} ${COLORS.dim}(Token Saver)${COLORS.reset}`);
      const headroomOn = data?.settings?.headroomEnabled === true;
      lines.push(`  Headroom: ${headroomOn ? `${COLORS.green}ON${COLORS.reset}` : `${COLORS.red}OFF${COLORS.reset}`} ${COLORS.dim}(${data?.settings?.headroomUrl || "http://localhost:8787"})${COLORS.reset}`);

      // Auth mode section
      const authMode = data?.settings?.authMode || "password";
      const authColor = authMode === "password" ? COLORS.green : COLORS.yellow;
      lines.push(`  Auth:     ${authColor}${authMode.toUpperCase()}${COLORS.reset} ${COLORS.dim}(login mode)${COLORS.reset}`);

      return lines.join("\n");
    },
    refresh: async () => {
      const result = await api.getSettings();
      return {
        settings: result.success ? (result.data || {}) : {}
      };
    },
    items: [
      {
        label: (d) => {
          const on = d?.settings?.rtkEnabled !== false;
          return `Token Saver (RTK): ${on ? "ON" : "OFF"} → toggle`;
        },
        action: async (d) => { await toggleRtk(d?.settings?.rtkEnabled !== false); return true; }
      },
      {
        label: (d) => {
          const on = d?.settings?.headroomEnabled === true;
          return `Token Saver (Headroom): ${on ? "ON" : "OFF"} → toggle`;
        },
        action: async (d) => { await toggleHeadroom(d?.settings?.headroomEnabled === true); return true; }
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

async function toggleHeadroom(currentlyOn) {
  const next = !currentlyOn;
  const result = await api.updateSettings({ headroomEnabled: next });
  if (result.success) {
    showStatus(`Headroom ${next ? "enabled" : "disabled"}`, "success");
  } else {
    showStatus(`Failed: ${result.error}`, "error");
  }
  await pause();
}

/**
 * Reset dashboard password to default via server API (writes the live SQLite DB).
 * After reset, user can log in with the default password "123456".
 */
async function resetPassword() {
  const ok = await confirm(`Reset dashboard password to default "${DEFAULT_PASSWORD}"?`);
  if (!ok) {
    showStatus("Cancelled", "info");
    await pause();
    return;
  }

  const result = await api.resetPassword();
  if (result.success) {
    showStatus(`Password reset. Default: ${DEFAULT_PASSWORD}`, "success");
  } else {
    showStatus(`Failed to reset password: ${result.error}`, "error");
  }
  await pause();
}

module.exports = { showSettingsMenu };
