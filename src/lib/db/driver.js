import fs from "node:fs";
import { ensureDirs, DATA_FILE } from "./paths.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

function detectRemoteDialect(url) {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.startsWith("postgres://") || lower.startsWith("postgresql://")) return "postgresql";
  if (lower.startsWith("mysql://") || lower.startsWith("mariadb://")) return "mysql";
  return null;
}

async function tryRemoteDb(url) {
  const dialect = detectRemoteDialect(url);
  if (!dialect) return null;
  try {
    if (dialect === "postgresql") {
      const { createPgAdapter } = await import("./adapters/pgAdapter.js");
      return await createPgAdapter(url);
    }
    if (dialect === "mysql") {
      const { createMysqlAdapter } = await import("./adapters/mysqlAdapter.js");
      return await createMysqlAdapter(url);
    }
  } catch (e) {
    console.error(`[DB] Remote DB (${dialect}) connection failed: ${e.message}`);
    throw e;
  }
  return null;
}

async function tryBunSqlite() {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function tryBetterSqlite() {
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions.bun) return null;
  try {
    const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
    return createBetterSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite() {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  try {
    const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
    return await createNodeSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] node:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function trySqlJs() {
  try {
    const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
    return await createSqlJsAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] sql.js unavailable: ${e.message}`);
    return null;
  }
}

async function initAdapter() {
  const dbUrl = process.env.DATABASE_URL;

  // Remote DB takes priority when DATABASE_URL is set
  if (dbUrl) {
    const remote = await tryRemoteDb(dbUrl);
    if (remote) {
      const { runMigrationOnce, migrateFromLocalSqlite } = await import("./migrate.js");
      await runMigrationOnce(remote);

      // One-time: copy local SQLite → remote when remote is fresh and local file exists
      if (fs.existsSync(DATA_FILE)) {
        const localSqlite = await tryBunSqlite() || await tryBetterSqlite() || await tryNodeSqlite() || await trySqlJs();
        if (localSqlite) {
          try {
            await migrateFromLocalSqlite(localSqlite, remote);
          } catch (e) {
            console.warn(`[DB][migrate] Local → remote copy failed: ${e.message}`);
          }
        }
      }

      return remote;
    }
  }

  // SQLite fallback chain
  ensureDirs();
  let adapter = await tryBunSqlite();
  if (!adapter) adapter = await tryBetterSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter) adapter = await trySqlJs();
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`);
    state.logged = true;
  }

  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
  return adapter;
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) state.initPromise = initAdapter().then((a) => { state.instance = a; return a; });
  return state.initPromise;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
