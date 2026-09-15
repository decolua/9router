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
    tokenLimit: row.tokenLimit != null ? Number(row.tokenLimit) : 0,
    usedTokens: row.usedTokens != null ? Number(row.usedTokens) : 0,
    allowedModels: row.allowedModels ? parseJson(row.allowedModels, null) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || null,
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

export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const now = new Date().toISOString();
  const tokenLimit = options.tokenLimit != null ? Math.max(0, Number(options.tokenLimit) || 0) : 0;
  const allowedModels = Array.isArray(options.allowedModels) && options.allowedModels.length > 0
    ? options.allowedModels.map((m) => String(m).trim()).filter(Boolean)
    : null;
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    tokenLimit,
    usedTokens: 0,
    allowedModels,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, tokenLimit, usedTokens, allowedModels, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      1,
      apiKey.tokenLimit,
      0,
      allowedModels ? stringifyJson(allowedModels) : null,
      apiKey.createdAt,
      apiKey.updatedAt,
    ]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToKey(row);
    const merged = { ...current, ...data, updatedAt: new Date().toISOString() };
    const tokenLimit = merged.tokenLimit != null ? Math.max(0, Number(merged.tokenLimit) || 0) : 0;
    const usedTokens = merged.usedTokens != null ? Math.max(0, Number(merged.usedTokens) || 0) : 0;
    const allowedModels = Array.isArray(merged.allowedModels)
      ? (merged.allowedModels.length > 0 ? merged.allowedModels.map((m) => String(m).trim()).filter(Boolean) : null)
      : null;
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, tokenLimit = ?, usedTokens = ?, allowedModels = ?, updatedAt = ? WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        tokenLimit,
        usedTokens,
        allowedModels ? stringifyJson(allowedModels) : null,
        merged.updatedAt,
        id,
      ]
    );
    result = {
      ...merged,
      tokenLimit,
      usedTokens,
      allowedModels,
    };
  });
  return result;
}

export async function incrementKeyTokens(key, tokens) {
  if (!key || !tokens || tokens <= 0) return;
  const db = await getAdapter();
  db.run(`UPDATE apiKeys SET usedTokens = COALESCE(usedTokens, 0) + ? WHERE key = ?`, [tokens, key]);
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
