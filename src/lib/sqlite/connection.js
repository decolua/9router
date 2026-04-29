// SQLite connection singleton. Opens one shared better-sqlite3 Database per
// process, applies pragmas, runs schema.sql, triggers auto-migration from
// legacy JSON on first boot. Only runs in the Node.js path (`!isCloud`);
// cloud/Workers callers must not import this file.

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { createRequire } from "node:module";
import { migrateFromJson } from "./migrate-from-json.js";
import { SCHEMA_SQL } from "./schema.js";

const require = createRequire(import.meta.url);

const APP_NAME = "9router";
const SQLITE_FILE_NAME = "9router.sqlite";
const SCHEMA_VERSION = "1";

function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  const homeDir = os.homedir();
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"),
      APP_NAME,
    );
  }
  return path.join(homeDir, `.${APP_NAME}`);
}

export const DATA_DIR = getDataDir();
export const SQLITE_FILE = path.join(DATA_DIR, SQLITE_FILE_NAME);

let dbInstance = null;
let schemaReady = false;

function applyPragmas(db) {
  // bun:sqlite has no `.pragma()` shorthand — fall back to exec.
  const setPragma = typeof db.pragma === "function"
    ? (s) => db.pragma(s)
    : (s) => db.exec(`PRAGMA ${s}`);
  setPragma("journal_mode = WAL");
  setPragma("synchronous = NORMAL");
  setPragma("foreign_keys = ON");
  setPragma("busy_timeout = 5000");
  // Concurrency tuning: bigger page cache, mmap reads, in-memory temp tables,
  // and a sane WAL checkpoint cadence to avoid long pauses under load.
  setPragma("cache_size = -64000");        // ~64 MB
  setPragma("mmap_size = 268435456");      // 256 MB
  setPragma("temp_store = MEMORY");
  setPragma("wal_autocheckpoint = 1000");
}

function ensureSchema(db) {
  if (schemaReady) return;
  db.exec(SCHEMA_SQL);
  schemaReady = true;
}

function readMeta(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : null;
}

function writeMeta(db, key, value) {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, String(value));
}

function runInitialMigration(db) {
  if (readMeta(db, "schema_version")) return;

  const summary = migrateFromJson(db, DATA_DIR);
  if (summary && summary.imported > 0) {
    console.log("[sqlite] migrated legacy JSON:", summary);
  }
  writeMeta(db, "schema_version", SCHEMA_VERSION);
}

export function getDatabase() {
  if (dbInstance) return dbInstance;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Under Bun, better-sqlite3 (native N-API) is unsupported — use the
  // built-in `bun:sqlite` instead. Both modules are kept external in
  // next.config.mjs so webpack leaves the require calls untouched and
  // they're resolved by the runtime's createRequire at call time.
  const Database = typeof Bun !== "undefined"
    ? require("bun:sqlite").Database
    : require("better-sqlite3");
  const db = new Database(SQLITE_FILE);
  applyPragmas(db);
  ensureSchema(db);
  runInitialMigration(db);

  dbInstance = db;
  return dbInstance;
}

export function closeDatabase() {
  if (dbInstance) {
    try { dbInstance.close(); } catch {}
    dbInstance = null;
    schemaReady = false;
  }
}

// Run `fn(db)` inside a BEGIN IMMEDIATE transaction. Returns fn's result.
export function tx(fn) {
  const db = getDatabase();
  const wrapped = db.transaction(fn);
  return wrapped.immediate(db);
}
