// CJS entry-point for CLI and standalone CJS scripts (cli/cli.js, cli/hooks/sqliteRuntime.js,
// cli/src/cli/api/client.js, src/lib/updater/updater.js).
// src/lib/dataDir.js is ESM (consumed by Next.js/webpack); this file mirrors the same logic.
"use strict";

const fs = require("node:fs");
const path = require("path");
const os = require("os");

const APP_NAME = "durindoor";
const LEGACY_APP_NAME = "9router";

function _defaultNewDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

function _legacyDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), LEGACY_APP_NAME);
  }
  return path.join(os.homedir(), `.${LEGACY_APP_NAME}`);
}

function _copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      _copyRecursive(srcPath, destPath);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function _migrateIfNeeded(newDir) {
  if (fs.existsSync(newDir)) return;
  const legacy = _legacyDir();
  if (!fs.existsSync(legacy)) return;
  console.log(`[dataDir] migrating ${legacy} → ${newDir} (one-time copy, original preserved)`);
  _copyRecursive(legacy, newDir);
}

function defaultDir() {
  const newDir = _defaultNewDir();
  _migrateIfNeeded(newDir);
  if (!fs.existsSync(newDir)) {
    fs.mkdirSync(newDir, { recursive: true });
  }
  return newDir;
}

function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) return defaultDir();

  if (process.platform === "win32" && /^\//.test(configured)) {
    console.warn(`[DATA_DIR] '${configured}' is a Unix path on Windows → fallback to default`);
    return defaultDir();
  }

  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch (e) {
    if (e && (e.code === "EACCES" || e.code === "EPERM")) {
      console.warn(`[DATA_DIR] '${configured}' not writable → fallback ~/.${APP_NAME}`);
      return defaultDir();
    }
    throw e;
  }
}

const DATA_DIR = getDataDir();

module.exports = { getDataDir, DATA_DIR };
