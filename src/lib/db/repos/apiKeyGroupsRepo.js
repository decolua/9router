import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { DEFAULT_API_KEY_GROUP_ID } from "../migrations/002-api-key-groups.js";
import { getSettings, updateSettings } from "./settingsRepo.js";

function rowToGroup(row, defaultGroupId = DEFAULT_API_KEY_GROUP_ID) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    allowedModels: parseJson(row.allowedModels, []),
    allowedCombos: parseJson(row.allowedCombos, []),
    keyCount: Number(row.keyCount || 0),
    isDefault: row.id === defaultGroupId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getApiKeyGroups() {
  const db = await getAdapter();
  const settings = await getSettings();
  const defaultGroupId = settings.defaultApiKeyGroupId || DEFAULT_API_KEY_GROUP_ID;
  return db.all(`SELECT g.*, COUNT(k.id) AS keyCount FROM apiKeyGroups g LEFT JOIN apiKeys k ON k.groupId = g.id GROUP BY g.id ORDER BY CASE WHEN g.id = ? THEN 0 ELSE 1 END, g.createdAt ASC`, [defaultGroupId]).map((row) => rowToGroup(row, defaultGroupId));
}

export async function getApiKeyGroupById(id) {
  const db = await getAdapter();
  const settings = await getSettings();
  return rowToGroup(db.get(`SELECT g.*, COUNT(k.id) AS keyCount FROM apiKeyGroups g LEFT JOIN apiKeys k ON k.groupId = g.id WHERE g.id = ? GROUP BY g.id`, [id]), settings.defaultApiKeyGroupId || DEFAULT_API_KEY_GROUP_ID);
}

export async function getDefaultApiKeyGroup() {
  const settings = await getSettings();
  return await getApiKeyGroupById(settings.defaultApiKeyGroupId || DEFAULT_API_KEY_GROUP_ID);
}

export async function setDefaultApiKeyGroup(id) {
  const group = await getApiKeyGroupById(id);
  if (!group) throw new Error("API key group not found");
  await updateSettings({ defaultApiKeyGroupId: id });
  return await getApiKeyGroupById(id);
}

export async function createApiKeyGroup({ name, allowedModels = [], allowedCombos = [] }) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const group = { id: uuidv4(), name, allowedModels, allowedCombos, createdAt: now, updatedAt: now };
  db.run(`INSERT INTO apiKeyGroups(id, name, allowedModels, allowedCombos, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`, [group.id, group.name, stringifyJson(group.allowedModels), stringifyJson(group.allowedCombos), now, now]);
  return { ...group, keyCount: 0, isDefault: false };
}

export async function updateApiKeyGroup(id, data) {
  const db = await getAdapter();
  const current = await getApiKeyGroupById(id);
  if (!current) return null;
  const merged = { ...current, ...data, updatedAt: new Date().toISOString() };
  db.run(`UPDATE apiKeyGroups SET name = ?, allowedModels = ?, allowedCombos = ?, updatedAt = ? WHERE id = ?`, [merged.name, stringifyJson(merged.allowedModels), stringifyJson(merged.allowedCombos), merged.updatedAt, id]);
  return await getApiKeyGroupById(id);
}

export async function deleteApiKeyGroup(id) {
  const settings = await getSettings();
  if (id === (settings.defaultApiKeyGroupId || DEFAULT_API_KEY_GROUP_ID)) {
    const error = new Error("默认分组不能删除");
    error.code = "GROUP_PROTECTED";
    throw error;
  }
  const db = await getAdapter();
  const keyCount = Number(db.get(`SELECT COUNT(*) AS count FROM apiKeys WHERE groupId = ?`, [id])?.count || 0);
  if (keyCount > 0) {
    const error = new Error("该分组仍有密钥正在使用");
    error.code = "GROUP_IN_USE";
    throw error;
  }
  return (db.run(`DELETE FROM apiKeyGroups WHERE id = ?`, [id])?.changes || 0) > 0;
}

export { DEFAULT_API_KEY_GROUP_ID };
