import fs from "node:fs";
import path from "path";
import os from "os";

const APP_NAME = "9router";

function defaultDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

export function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) return defaultDir();

  // On Windows, ignore Unix-style absolute paths (e.g. /var/lib/...) that come
  // from a Linux-targeted .env or Docker config — they are not valid here.
  if (process.platform === "win32" && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return defaultDir();
  }

  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e) {
    // Never throw from here: this runs at module-import time, so a throw takes
    // down every module that imports the db layer (crash-loop in Next dev /
    // build / CLI). EACCES/EPERM already fell back; ENOTDIR/EEXIST (DATA_DIR
    // pointing at a file or through a dead symlink), EROFS and anything else
    // get the same treatment (T1.4 L-3) — with a loud warning, never silence.
    const reason = e?.code || e?.message || String(e);
    console.warn(`[DATA_DIR] '${configured}' unusable (${reason}) → fallback ~/.${APP_NAME}`);
    return defaultDir();
  }
}

export const DATA_DIR = getDataDir();
