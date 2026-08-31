import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
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

export async function createApiKey(name, machineId) {
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
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt]
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
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, id]
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
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}

/**
 * Resolve a bearer key string to the set of provider-connection ids it may use.
 * A key with zero apiKeyAccounts rows is unrestricted (full pool) — back-compat
 * default for keys created before this scoping feature existed.
 * @param {string} keyString
 * @returns {Promise<Set<string>|null>} null = key not found OR unrestricted; Set = restricted
 */
export async function getAllowedConnectionIdsForKey(keyString) {
  const db = await getAdapter();
  const row = db.get(`SELECT id FROM apiKeys WHERE key = ? AND isActive = 1`, [keyString]);
  if (!row) return null;
  const rows = db.all(`SELECT connectionId FROM apiKeyAccounts WHERE apiKeyId = ?`, [row.id]);
  if (rows.length === 0) return null;
  return new Set(rows.map((r) => r.connectionId));
}

/**
 * List the provider-connection ids currently assigned to a key (UI mapping view).
 * @param {string} apiKeyId
 * @returns {Promise<string[]>}
 */
export async function getKeyAccounts(apiKeyId) {
  const db = await getAdapter();
  const rows = db.all(`SELECT connectionId FROM apiKeyAccounts WHERE apiKeyId = ?`, [apiKeyId]);
  return rows.map((r) => r.connectionId);
}

/**
 * Replace the full set of accounts assigned to a key. Empty array = unrestricted.
 * @param {string} apiKeyId
 * @param {string[]} connectionIdsArray
 */
export async function setKeyAccounts(apiKeyId, connectionIdsArray) {
  const db = await getAdapter();
  const ids = Array.isArray(connectionIdsArray) ? [...new Set(connectionIdsArray)] : [];
  db.transaction(() => {
    db.run(`DELETE FROM apiKeyAccounts WHERE apiKeyId = ?`, [apiKeyId]);
    for (const connectionId of ids) {
      db.run(`INSERT INTO apiKeyAccounts(apiKeyId, connectionId) VALUES(?, ?)`, [apiKeyId, connectionId]);
    }
  });
  return ids;
}
