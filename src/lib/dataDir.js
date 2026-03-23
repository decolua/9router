import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const APP_NAME = "9router";

/**
 * Resolve the data directory for 9router.
 * Priority:
 *   1. DATA_DIR env var (Docker / custom deployments)
 *   2. XDG_CONFIG_HOME env var on non-Windows ($XDG_CONFIG_HOME/9router/)
 *   3. Platform default (~/.9router on Unix, %APPDATA%/9router on Windows)
 *
 * For XDG: if XDG path doesn't exist but the legacy ~/.9router does,
 * fall back to legacy path to avoid data loss for existing users.
 */
export function getUserDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  const platform = process.platform;
  const homeDir = os.homedir();

  if (platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), APP_NAME);
  }

  // Unix (Linux & macOS): check XDG_CONFIG_HOME
  const legacyDir = path.join(homeDir, `.${APP_NAME}`);

  if (process.env.XDG_CONFIG_HOME) {
    const xdgDir = path.join(process.env.XDG_CONFIG_HOME, APP_NAME);
    // Backward compat: prefer legacy path if it exists and XDG path doesn't
    if (!fs.existsSync(xdgDir) && fs.existsSync(legacyDir)) {
      return legacyDir;
    }
    return xdgDir;
  }

  return legacyDir;
}
