const fs = require("fs");
const path = require("path");
const os = require("os");

const APP_NAME = "9router";

function defaultDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) return defaultDir();
  try {
    fs.mkdirSync(configured, { recursive: true });
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      throw new Error(
        `DATA_DIR '${configured}' could not be created (${e.code}: ${e.message}). ` +
        `Create the directory or choose a writable DATA_DIR.`
      );
    }
    throw e;
  }
  try {
    fs.accessSync(configured, fs.constants.W_OK);
  } catch (e) {
    throw new Error(
      `DATA_DIR '${configured}' is not writable (${e.code ?? "EACCES"}: ${e.message}). ` +
      `Create the directory or choose a writable DATA_DIR.`
    );
  }
  return configured;
}

const DATA_DIR = getDataDir();
const MITM_DIR = path.join(DATA_DIR, "mitm");
try { fs.mkdirSync(MITM_DIR, { recursive: true }); } catch {}

module.exports = { DATA_DIR, MITM_DIR };
