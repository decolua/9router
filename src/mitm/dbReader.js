// CJS reader for MITM standalone process. Reads SQLite mitmAlias scope.
// Falls back to legacy db.json or db.json.migrated if SQLite unavailable.
const fs = require("fs");
const path = require("path");
const { DATA_DIR } = require("./paths");

const DB_FILE = path.join(DATA_DIR, "db", "data.sqlite");
const LEGACY_JSON = path.join(DATA_DIR, "db.json");
const LEGACY_MIGRATED = path.join(DATA_DIR, "db.json.migrated");

let sqliteDb = null;
let sqliteFailed = false;

function trySqlite() {
  if (sqliteDb) return sqliteDb;
  if (sqliteFailed) return null;
  try {
    if (!fs.existsSync(DB_FILE)) return null;
    const Database = require("better-sqlite3");
    sqliteDb = new Database(DB_FILE, { readonly: true, fileMustExist: true });
    return sqliteDb;
  } catch {
    sqliteFailed = true;
    return null;
  }
}

function readLegacyJson() {
  for (const file of [LEGACY_JSON, LEGACY_MIGRATED]) {
    if (!fs.existsSync(file)) continue;
    try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch {}
  }
  return null;
}

function getMitmAlias(toolName) {
  const db = trySqlite();
  if (db) {
    try {
      const row = db.prepare(`SELECT value FROM kv WHERE scope = 'mitmAlias' AND key = ?`).get(toolName);
      if (row) return JSON.parse(row.value);
    } catch {}
  }
  // Fallback to legacy JSON
  const legacy = readLegacyJson();
  return legacy?.mitmAlias?.[toolName] || null;
}

module.exports = { getMitmAlias };
