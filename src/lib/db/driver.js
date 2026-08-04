import { ensureDirs, DATA_FILE } from "./paths.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

const NATIVE_OPEN_RETRIES = 3;
const NATIVE_OPEN_RETRY_MS = 200;

function isDatabaseLocked(error) {
  return /database is locked|database is busy|SQLITE_BUSY|SQLITE_LOCKED/i.test(String(error?.message || error || ""));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function tryBunSqlite() {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(DATA_FILE);
  } catch (e) {
    if (isDatabaseLocked(e)) state.nativeDbLocked = e;
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
    if (isDatabaseLocked(e)) state.nativeDbLocked = e;
    console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite() {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  for (let attempt = 0; attempt < NATIVE_OPEN_RETRIES; attempt++) {
    try {
      const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
      return await createNodeSqliteAdapter(DATA_FILE);
    } catch (e) {
      if (!isDatabaseLocked(e) || attempt === NATIVE_OPEN_RETRIES - 1) {
        if (isDatabaseLocked(e)) state.nativeDbLocked = e;
        console.warn(`[DB] node:sqlite unavailable: ${e.message}`);
        return null;
      }
      await wait(NATIVE_OPEN_RETRY_MS * (attempt + 1));
    }
  }
  return null;
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
  ensureDirs();
  state.nativeDbLocked = null;
  // Order per runtime:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  let adapter = await tryBunSqlite();
  if (!adapter) adapter = await tryBetterSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter && state.nativeDbLocked) {
    throw new Error(`[DB] ${state.nativeDbLocked.message}. Database is in use; refusing unsafe sql.js fallback.`);
  }
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
  if (!state.initPromise) {
    state.initPromise = initAdapter().then((a) => { state.instance = a; return a; }).catch((error) => {
      state.initPromise = null;
      throw error;
    });
  }
  return state.initPromise;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
