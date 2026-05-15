import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function normalizeDailyTokenLimit(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function normalizeExpiresAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeAllowedModels(value) {
  const list = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(list)) return [];
  return Array.from(
    new Set(
      list
        .map((model) => (typeof model === "string" ? model.trim() : ""))
        .filter(Boolean)
    )
  );
}

export function normalizeApiKeyPolicy(data = {}) {
  return {
    dailyTokenLimit: normalizeDailyTokenLimit(data.dailyTokenLimit),
    expiresAt: normalizeExpiresAt(data.expiresAt),
    allowedModels: normalizeAllowedModels(data.allowedModels),
  };
}

function isExpired(expiresAt) {
  return !!expiresAt && new Date(expiresAt).getTime() <= Date.now();
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    dailyTokenLimit: normalizeDailyTokenLimit(row.dailyTokenLimit),
    expiresAt: normalizeExpiresAt(row.expiresAt),
    allowedModels: normalizeAllowedModels(row.allowedModels),
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
  const policy = normalizeApiKeyPolicy(options);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    ...policy,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, dailyTokenLimit, expiresAt, allowedModels, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      1,
      apiKey.dailyTokenLimit,
      apiKey.expiresAt,
      stringifyJson(apiKey.allowedModels),
      apiKey.createdAt,
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
    const existing = rowToKey(row);
    const policyPatch = {};
    if (Object.prototype.hasOwnProperty.call(data, "dailyTokenLimit")) {
      policyPatch.dailyTokenLimit = normalizeDailyTokenLimit(data.dailyTokenLimit);
    }
    if (Object.prototype.hasOwnProperty.call(data, "expiresAt")) {
      policyPatch.expiresAt = normalizeExpiresAt(data.expiresAt);
    }
    if (Object.prototype.hasOwnProperty.call(data, "allowedModels")) {
      policyPatch.allowedModels = normalizeAllowedModels(data.allowedModels);
    }
    const merged = { ...existing, ...data, ...policyPatch };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, dailyTokenLimit = ?, expiresAt = ?, allowedModels = ? WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        merged.dailyTokenLimit,
        merged.expiresAt,
        stringifyJson(merged.allowedModels),
        id,
      ]
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
  const row = await getApiKeyByKey(key);
  if (!row) return false;
  return row.isActive && !isExpired(row.expiresAt);
}
