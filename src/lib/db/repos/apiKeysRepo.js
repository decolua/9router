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
    rateLimit: row.rateLimit ?? 60,
    allowedModels: row.allowedModels ? JSON.parse(row.allowedModels) : [],
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

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const rateLimit = Number(options.rateLimit) > 0 ? Number(options.rateLimit) : 60;
  const allowedModels = Array.isArray(options.allowedModels) ? options.allowedModels : [];
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    rateLimit,
    allowedModels,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, rateLimit, allowedModels, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.rateLimit, JSON.stringify(apiKey.allowedModels), apiKey.createdAt]
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
    if (data.rateLimit !== undefined) {
      merged.rateLimit = Number(data.rateLimit) > 0 ? Number(data.rateLimit) : 60;
    }
    if (data.allowedModels !== undefined) {
      merged.allowedModels = Array.isArray(data.allowedModels) ? data.allowedModels : [];
    }
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, rateLimit = ?, allowedModels = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, merged.rateLimit, JSON.stringify(merged.allowedModels), id]
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

export async function getApiKeyByValue(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
