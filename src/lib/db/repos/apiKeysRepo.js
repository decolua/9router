import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function parseJsonArray(value, defaultValue) {
  if (!value) return defaultValue;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : defaultValue;
  } catch {
    return defaultValue;
  }
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    allowedModels: parseJsonArray(row.allowedModels, []),
    blockedModels: parseJsonArray(row.blockedModels, []),
    allowedCombos: parseJsonArray(row.allowedCombos, []),
    scopes: parseJsonArray(row.scopes, ["manage"]),
    expiresAt: row.expiresAt || null,
    lastUsedAt: row.lastUsedAt || null,
    maxRequestsPerDay: row.maxRequestsPerDay ?? null,
    maxSpendUsdPerDay: row.maxSpendUsdPerDay ?? null,
    createdAt: row.createdAt,
  };
}

function keyToRow(key) {
  return {
    ...key,
    isActive: key.isActive ? 1 : 0,
    allowedModels: JSON.stringify(key.allowedModels || []),
    blockedModels: JSON.stringify(key.blockedModels || []),
    allowedCombos: JSON.stringify(key.allowedCombos || []),
    scopes: JSON.stringify(key.scopes || ["manage"]),
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

export async function createApiKey(name, machineId, extra = {}) {
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
    allowedModels: extra.allowedModels || [],
    blockedModels: extra.blockedModels || [],
    allowedCombos: extra.allowedCombos || [],
    scopes: extra.scopes || ["manage"],
    expiresAt: extra.expiresAt || null,
    lastUsedAt: null,
    maxRequestsPerDay: extra.maxRequestsPerDay ?? null,
    maxSpendUsdPerDay: extra.maxSpendUsdPerDay ?? null,
    createdAt: new Date().toISOString(),
  };
  const row = keyToRow(apiKey);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedModels, blockedModels, allowedCombos, scopes, expiresAt, lastUsedAt, maxRequestsPerDay, maxSpendUsdPerDay, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.key, row.name, row.machineId, row.isActive, row.allowedModels, row.blockedModels, row.allowedCombos, row.scopes, row.expiresAt, row.lastUsedAt, row.maxRequestsPerDay, row.maxSpendUsdPerDay, row.createdAt]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = {
      ...rowToKey(row),      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.allowedModels !== undefined ? { allowedModels: data.allowedModels } : {}),
      ...(data.blockedModels !== undefined ? { blockedModels: data.blockedModels } : {}),
      ...(data.allowedCombos !== undefined ? { allowedCombos: data.allowedCombos } : {}),
      ...(data.scopes !== undefined ? { scopes: data.scopes } : {}),
      ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
      ...(data.maxRequestsPerDay !== undefined ? { maxRequestsPerDay: data.maxRequestsPerDay } : {}),
      ...(data.maxSpendUsdPerDay !== undefined ? { maxSpendUsdPerDay: data.maxSpendUsdPerDay } : {}),
    };
    const r = keyToRow(merged);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, allowedModels = ?, blockedModels = ?, allowedCombos = ?, scopes = ?, expiresAt = ?, maxRequestsPerDay = ?, maxSpendUsdPerDay = ? WHERE id = ?`,
      [r.key, r.name, r.machineId, r.isActive, r.allowedModels, r.blockedModels, r.allowedCombos, r.scopes, r.expiresAt, r.maxRequestsPerDay, r.maxSpendUsdPerDay, id]
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

export async function getApiKeyMetadata(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function touchApiKey(key) {
  const db = await getAdapter();
  db.run(`UPDATE apiKeys SET lastUsedAt = ? WHERE key = ?`, [new Date().toISOString(), key]);
}
