const path = require("path");
const os = require("os");
const fs = require("fs");

// Single source of truth for data directory — matches dataDir.js logic
function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }

  // Unix (Linux & macOS): check XDG_CONFIG_HOME
  const homeDir = os.homedir();
  const legacyDir = path.join(homeDir, ".9router");

  if (process.env.XDG_CONFIG_HOME) {
    const xdgDir = path.join(process.env.XDG_CONFIG_HOME, "9router");
    // Backward compat: prefer legacy path if it exists and XDG path doesn't
    if (!fs.existsSync(xdgDir) && fs.existsSync(legacyDir)) {
      return legacyDir;
    }
    return xdgDir;
  }

  return legacyDir;
}

const DATA_DIR = getDataDir();
const MITM_DIR = path.join(DATA_DIR, "mitm");

module.exports = { DATA_DIR, MITM_DIR };
