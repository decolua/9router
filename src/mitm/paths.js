const fs = require("fs");
const path = require("path");
const os = require("os");

function getDefaultDataDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}

function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (configured) {
    try {
      fs.mkdirSync(configured, { recursive: true });
      return configured;
    } catch (error) {
      if (error?.code === "EACCES" || error?.code === "EPERM") {
        console.warn(
          `[DATA_DIR] Cannot use configured DATA_DIR='${configured}' because it is not writable. Falling back to default user directory.`,
        );
      } else {
        console.warn(
          `[DATA_DIR] Unable to initialize configured DATA_DIR='${configured}': ${error?.message}. Falling back to default user directory.`,
        );
      }
    }
  }
  return getDefaultDataDir();
}

const DATA_DIR = getDataDir();
const MITM_DIR = path.join(DATA_DIR, "mitm");

module.exports = { DATA_DIR, MITM_DIR };
