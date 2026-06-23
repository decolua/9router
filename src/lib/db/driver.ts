import { ensureDirs, DATA_FILE } from "./paths.js";

/** Normalised adapter shape all four SQLite drivers conform to. */
export interface DbAdapter {
  driver: string;
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number } | void;
  get(sql: string, params?: unknown[]): Record<string, unknown> | undefined;
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  exec(sql: string): void;
  transaction(fn: () => void): void;
  checkpoint?(): void;
  close(): void;
  raw?: unknown;
}

interface DbAdapterState {
  instance: DbAdapter | null;
  initPromise: Promise<DbAdapter> | null;
  logged: boolean;
}

declare global {
  // eslint-disable-next-line no-var
  var _dbAdapter: DbAdapterState | undefined;
}

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!globalThis._dbAdapter)
  globalThis._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = globalThis._dbAdapter;

async function tryBunSqlite(): Promise<DbAdapter | null> {
  // Bun runtime only — built-in, no install needed
  if (!process.versions["bun"]) return null;
  try {
    // Dynamic import: bun:sqlite only exists under Bun runtime, not statically resolvable.
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] bun:sqlite unavailable: ${(e as Error).message}`);
    return null;
  }
}

async function tryBetterSqlite(): Promise<DbAdapter | null> {
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions["bun"]) return null;
  try {
    // Dynamic import: better-sqlite3 is an optional native dep; may not be installed.
    const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
    return createBetterSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] better-sqlite3 unavailable: ${(e as Error).message}`);
    return null;
  }
}

async function tryNodeSqlite(): Promise<DbAdapter | null> {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions["bun"]) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if ((maj ?? 0) < 22 || ((maj ?? 0) === 22 && (min ?? 0) < 5)) return null;
  try {
    // Dynamic import: node:sqlite is experimental and Node-version-gated.
    const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
    return await createNodeSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] node:sqlite unavailable: ${(e as Error).message}`);
    return null;
  }
}

async function trySqlJs(): Promise<DbAdapter | null> {
  try {
    // Dynamic import: sql.js is the last-resort fallback across all runtimes.
    const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
    return await createSqlJsAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] sql.js unavailable: ${(e as Error).message}`);
    return null;
  }
}

async function initAdapter(): Promise<DbAdapter> {
  ensureDirs();
  // Order per runtime:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  let adapter = await tryBunSqlite();
  if (!adapter) adapter = await tryBetterSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter) adapter = await trySqlJs();
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`);
    state.logged = true;
  }

  // Dynamic import: migrate.js dynamically imports driver.js to break the circular
  // dependency (driver → migrate → driver). Must stay dynamic.
  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
  return adapter;
}

export async function getAdapter(): Promise<DbAdapter> {
  if (state.instance) return state.instance;
  if (!state.initPromise)
    state.initPromise = initAdapter().then((a) => {
      state.instance = a;
      return a;
    });
  return state.initPromise;
}

export function getAdapterSync(): DbAdapter {
  if (!state.instance)
    throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
