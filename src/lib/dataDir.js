import fs from "node:fs";
import path from "path";
import os from "os";

const APP_NAME = "9router";

function getDefaultDataDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

export function getDataDir() {
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

export const DATA_DIR = getDataDir();
