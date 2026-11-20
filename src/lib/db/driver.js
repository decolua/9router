import { ensureDirs, DATA_FILE } from "./paths.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

function isCloudflareWorker() {
  try {
    if (typeof WebSocketPair !== "undefined") return true;
    if (typeof navigator !== "undefined" && navigator?.userAgent === "Cloudflare-Workers") return true;
    if (process.env.OPENNEXT_CLOUDFLARE === "1") return true;
  } catch {}
  return false;
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
  if (process.versions?.bun) return null;
  // Skip on Node >= 24: the native addon SIGSEGVs on load there, which is a
  // process-level crash the try/catch below cannot recover from. node:sqlite covers it.
  const [nodeMajor] = (process.versions?.node || "0").split(".").map(Number);
  if (nodeMajor >= 24) return null;
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
  if (process.versions?.bun) return null;
  const nodeVer = process.versions?.node;
  if (!nodeVer) return null;
  const [maj, min] = nodeVer.split(".").map(Number);
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

async function tryD1() {
  try {
    // Access the D1 binding from Cloudflare Workers environment.
    // The binding is set on globalThis by the Workers runtime / OpenNext.
    const cfCtx = globalThis[Symbol.for("__cloudflare-context__")];
    const d1 = cfCtx?.env?.DB;
    if (!d1) return null;
    const { createD1Adapter } = await import("./adapters/d1Adapter.js");
    return await createD1Adapter(d1);
  } catch (e) {
    console.warn(`[DB] D1 unavailable: ${e.message}`);
    return null;
  }
}

async function tryMemory() {
  try {
    const { createMemoryAdapter } = await import("./adapters/memoryAdapter.js");
    return createMemoryAdapter();
  } catch (e) {
    console.warn(`[DB] memory adapter unavailable: ${e.message}`);
    return null;
  }
}

async function initAdapter() {
  const isCf = isCloudflareWorker();

  // In Cloudflare Workers, skip file-system drivers entirely → use D1 or in-memory
  if (isCf) {
    // Try D1 first (persistent), fall back to volatile in-memory
    let adapter = await tryD1();
    if (!adapter) adapter = await tryMemory();
    if (!adapter) throw new Error("[DB] No driver available in Cloudflare Workers");
    if (!state.logged) {
      console.log(`[DB] Driver: ${adapter.driver} (Cloudflare Workers)`);
      state.logged = true;
    }
    return adapter;
  }

  ensureDirs();
  // Order per runtime:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js → memory (last resort)
  let adapter = await tryBunSqlite();
  if (!adapter) adapter = await tryBetterSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter) adapter = await trySqlJs();
  if (!adapter) adapter = await tryMemory();
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js/memory all failed)");

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
