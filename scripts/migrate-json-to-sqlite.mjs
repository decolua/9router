#!/usr/bin/env node
// One-shot CLI to import legacy lowdb JSON files into the SQLite store.
//
// On normal boot the same migration runs automatically (see
// src/lib/sqlite/connection.js → runInitialMigration). Use this script when
// you need to:
//   - Re-run after restoring .bak files (combine with --force)
//   - Migrate a foreign DATA_DIR (DATA_DIR=/path/to/data node ...)
//   - Inspect the row counts that would be imported, without booting Next.js
//
// Usage:
//   node scripts/migrate-json-to-sqlite.mjs [--force] [--data-dir=PATH]
//
// Flags:
//   --force           Migrate even if meta.schema_version is already set.
//   --data-dir=PATH   Override DATA_DIR for this run.

import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { SCHEMA_SQL } from "../src/lib/sqlite/schema.js";

const require = createRequire(import.meta.url);

const APP_NAME = "9router";
const SQLITE_FILE_NAME = "9router.sqlite";

function parseArgs(argv) {
  const out = { force: false, dataDir: null };
  for (const a of argv) {
    if (a === "--force") out.force = true;
    else if (a.startsWith("--data-dir=")) out.dataDir = a.slice("--data-dir=".length);
  }
  return out;
}

function resolveDataDir(override) {
  if (override) return override;
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), APP_NAME);
  }
  return path.join(home, `.${APP_NAME}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = resolveDataDir(args.dataDir);

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const sqliteFile = path.join(dataDir, SQLITE_FILE_NAME);
  const Database = typeof Bun !== "undefined"
    ? require(["bun", "sqlite"].join(":")).Database
    : require(["better", "sqlite3"].join("-"));
  const db = new Database(sqliteFile);
  const setPragma = typeof db.pragma === "function"
    ? (s) => db.pragma(s)
    : (s) => db.exec(`PRAGMA ${s}`);
  setPragma("journal_mode = WAL");
  setPragma("synchronous = NORMAL");
  setPragma("foreign_keys = ON");
  setPragma("busy_timeout = 5000");
  db.exec(SCHEMA_SQL);

  const versionRow = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (versionRow && !args.force) {
    console.log(`[migrate] SQLite already at schema_version=${versionRow.value}. Use --force to re-import.`);
    db.close();
    return;
  }

  const { migrateFromJson } = await import("../src/lib/sqlite/migrate-from-json.js");
  console.log(`[migrate] DATA_DIR=${dataDir}`);
  console.log(`[migrate] sqlite=${sqliteFile}`);
  const summary = migrateFromJson(db, dataDir);

  if (!summary.imported) {
    console.log("[migrate] no legacy JSON files found.");
  } else {
    console.log(`[migrate] imported ${summary.imported} rows:`);
    for (const f of summary.files) console.log(`  - ${f.file}: ${f.rows} rows`);
  }

  db.prepare(
    "INSERT INTO meta(key, value) VALUES ('schema_version', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run();
  db.close();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
