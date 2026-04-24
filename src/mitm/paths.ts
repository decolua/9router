import path from "path";
import os from "os";

// Single source of truth for data directory — matches localDb.ts logic
function getDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "8router");
  }
  return path.join(os.homedir(), ".8router");
}

export const DATA_DIR: string = getDataDir();
export const MITM_DIR: string = path.join(DATA_DIR, "mitm");
