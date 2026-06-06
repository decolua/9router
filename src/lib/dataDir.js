import fs from "node:fs";
import path from "path";
import os from "os";

const APP_NAME = "9router";

function defaultDir() {
  // During `next build` (static generation) never touch the real user runtime
  // DB — route to a throwaway temp dir so packaging/CI cannot migrate or
  // corrupt ~/.9router. An explicit DATA_DIR env still overrides this.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return path.join(os.tmpdir(), `${APP_NAME}-build`);
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

export function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) return defaultDir();
  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      console.warn(`[DATA_DIR] '${configured}' not writable → fallback ~/.${APP_NAME}`);
      return defaultDir();
    }
    throw e;
  }
}

export const DATA_DIR = getDataDir();
