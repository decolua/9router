import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import {
  registerCustomAdapter,
  unregisterCustomAdapter,
  loadCustomAdaptersFromDir,
  initCustomAdaptersWatcher,
  getAllCustomAdapters,
  normalizeAdapterDefinition,
} from "open-sse/custom-adapters/loader.js";

function rowToAdapter(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return normalizeAdapterDefinition({
    ...extra,
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    baseUrl: row.baseUrl,
    authType: row.authType,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }, "db");
}

function adapterToRow(a) {
  const { id, name, prefix, baseUrl, authType, createdAt, updatedAt, source, filePath, ...rest } = a;
  return {
    id,
    name: name ?? null,
    prefix: prefix ?? null,
    baseUrl: baseUrl ?? null,
    authType: authType ?? "apikey",
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, a) {
  const r = adapterToRow(a);
  db.run(
    `INSERT INTO customAdapters(id, name, prefix, baseUrl, authType, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, prefix=excluded.prefix, baseUrl=excluded.baseUrl, authType=excluded.authType, data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.name, r.prefix, r.baseUrl, r.authType, r.data, r.createdAt, r.updatedAt]
  );
}

/**
 * Gets all custom adapters from database and filesystem.
 */
export async function getCustomAdapters() {
  const db = await getAdapter();
  const dbRows = db.all(`SELECT * FROM customAdapters ORDER BY createdAt DESC`);
  const dbAdapters = dbRows.map(rowToAdapter);

  // Sync DB adapters into memory registry
  for (const a of dbAdapters) {
    registerCustomAdapter(a, "db");
  }

  // Return combined list from memory registry (includes both DB and file-based)
  return getAllCustomAdapters();
}

/**
 * Gets a custom adapter by ID.
 */
export async function getCustomAdapterById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM customAdapters WHERE id = ?`, [id]);
  if (row) {
    const adapter = rowToAdapter(row);
    registerCustomAdapter(adapter, "db");
    return adapter;
  }
  // Fallback to memory / file-based
  const all = getAllCustomAdapters();
  return all.find((a) => a.id === id || a.prefix === id) || null;
}

/**
 * Creates a new custom adapter in DB and memory registry.
 */
export async function createCustomAdapter(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const id = data.id?.trim() || `custom-adapter-${uuidv4().slice(0, 8)}`;
  const prefix = (data.prefix?.trim() || id).toLowerCase();

  const adapter = normalizeAdapterDefinition({
    ...data,
    id,
    prefix,
    createdAt: now,
    updatedAt: now,
  }, "db");

  upsert(db, adapter);
  registerCustomAdapter(adapter, "db");
  return adapter;
}

/**
 * Updates a custom adapter in DB and memory registry.
 */
export async function updateCustomAdapter(id, data) {
  const db = await getAdapter();
  let result = null;

  db.transaction(() => {
    const row = db.get(`SELECT * FROM customAdapters WHERE id = ?`, [id]);
    if (!row) return;

    const existing = rowToAdapter(row);
    const updated = normalizeAdapterDefinition({
      ...existing,
      ...data,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    }, "db");

    upsert(db, updated);
    registerCustomAdapter(updated, "db");
    result = updated;
  });

  return result;
}

/**
 * Deletes a custom adapter from DB and memory registry.
 */
export async function deleteCustomAdapter(id) {
  const db = await getAdapter();
  let removed = null;

  db.transaction(() => {
    const row = db.get(`SELECT * FROM customAdapters WHERE id = ?`, [id]);
    if (row) {
      removed = rowToAdapter(row);
      db.run(`DELETE FROM customAdapters WHERE id = ?`, [id]);
    }
  });

  unregisterCustomAdapter(id);
  return removed;
}

/**
 * Initialize custom adapters: loads files from directory, initializes watcher, and syncs DB.
 */
export async function initCustomAdapters() {
  await loadCustomAdaptersFromDir();
  initCustomAdaptersWatcher();
  await getCustomAdapters();
}
