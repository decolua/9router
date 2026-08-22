import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { DEFAULT_API_KEY_GROUP_ID } from "./apiKeyGroupsRepo.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    allowedModels: parseJson(row.allowedModels, []),
    allowedCombos: parseJson(row.allowedCombos, []),
    groupId: row.groupId || null,
    groupName: row.groupName || null,
    createdAt: row.createdAt,
  };
}

const KEY_SELECT = `SELECT k.*, g.name AS groupName FROM apiKeys k LEFT JOIN apiKeyGroups g ON g.id = k.groupId`;

export async function getApiKeys() {
  const db = await getAdapter();
  return db.all(`${KEY_SELECT} ORDER BY k.createdAt ASC`).map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  return rowToKey(db.get(`${KEY_SELECT} WHERE k.id = ?`, [id]));
}

export async function getApiKeyByValue(key) {
  const db = await getAdapter();
  return rowToKey(db.get(`${KEY_SELECT} WHERE k.key = ?`, [key]));
}

export async function createApiKey(name, machineId, groupId = DEFAULT_API_KEY_GROUP_ID) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  if (!db.get(`SELECT id FROM apiKeyGroups WHERE id = ?`, [groupId])) throw new Error("API key group not found");
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = { id: uuidv4(), name, key: result.key, machineId, isActive: true, groupId, createdAt: new Date().toISOString() };
  db.run(`INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedModels, allowedCombos, groupId, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`, [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, stringifyJson([]), stringifyJson([]), groupId, apiKey.createdAt]);
  return await getApiKeyById(apiKey.id);
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  const current = await getApiKeyById(id);
  if (!current) return null;
  const merged = { ...current, ...data };
  if (merged.groupId && !db.get(`SELECT id FROM apiKeyGroups WHERE id = ?`, [merged.groupId])) throw new Error("API key group not found");
  db.run(`UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, allowedModels = ?, allowedCombos = ?, groupId = ? WHERE id = ?`, [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, stringifyJson(Array.isArray(merged.allowedModels) ? merged.allowedModels : []), stringifyJson(Array.isArray(merged.allowedCombos) ? merged.allowedCombos : []), merged.groupId || DEFAULT_API_KEY_GROUP_ID, id]);
  return await getApiKeyById(id);
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  return (db.run(`DELETE FROM apiKeys WHERE id = ?`, [id])?.changes || 0) > 0;
}

export async function validateApiKey(key) {
  const row = await getApiKeyByValue(key);
  return !!row?.isActive;
}
