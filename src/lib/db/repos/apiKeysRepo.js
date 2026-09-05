import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    allowedModels: parseJson(row.allowedModels, null),
    expiresAt: row.expiresAt || null,
  };
}

export function isKeyExpired(expiresAt, now = new Date()) {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return false;
  return t < now.getTime();
}

/**
 * True when an api key row allows `modelStr`.
 * null allowedModels = allow everything (default). Empty array = deny all.
 * Entries match a bare model id, `provider/model`, or a combo name.
 */
export function isModelAllowedForKey(row, modelStr) {
  if (!row) return false;
  if (!modelStr) return true;
  if (!Array.isArray(row.allowedModels)) return true;
  if (row.allowedModels.length === 0) return false;
  const target = String(modelStr).trim();
  const bare = target.includes("/") ? target.slice(target.indexOf("/") + 1) : target;
  return row.allowedModels.some((m) => {
    const entry = String(m || "").trim();
    if (!entry) return false;
    if (entry === target) return true;
    if (entry === bare) return true;
    const entryBare = entry.includes("/") ? entry.slice(entry.indexOf("/") + 1) : entry;
    return entryBare === bare;
  });
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function getApiKeyByKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    allowedModels: options.allowedModels || null,
    expiresAt: options.expiresAt || null,
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, allowedModels, expiresAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, apiKey.allowedModels ? stringifyJson(apiKey.allowedModels) : null, apiKey.expiresAt]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, allowedModels = ?, expiresAt = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, merged.allowedModels ? stringifyJson(merged.allowedModels) : null, merged.expiresAt || null, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive, expiresAt FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  if (row.isActive !== 1 && row.isActive !== true) return false;
  if (isKeyExpired(row.expiresAt)) return false;
  return true;
}
