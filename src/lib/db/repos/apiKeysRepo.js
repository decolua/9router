import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { keyAccessFromColumns, keyAccessToColumns, normalizeAllowList } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

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
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
  };
}

function accessForWrite(data, existing = KEY_ACCESS_UNRESTRICTED) {
  if (data.access !== undefined) return data.access;
  if (data.allowedModels !== undefined) {
    const allow = normalizeAllowList(data.allowedModels);
    return { restricted: allow.length > 0, allow };
  }
  return existing;
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

// Used by the /v1 handlers to read the presented key's access settings.
export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
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
    access: accessForWrite(extra),
  };
  const row = keyToRow(apiKey);
  const cols = keyAccessToColumns(apiKey.access);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, allowedModels, blockedModels, allowedCombos, scopes, expiresAt, lastUsedAt, maxRequestsPerDay, maxSpendUsdPerDay, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.key, row.name, row.machineId, row.isActive, row.allowedModels, row.blockedModels, row.allowedCombos, row.scopes, row.expiresAt, row.lastUsedAt, row.maxRequestsPerDay, row.maxSpendUsdPerDay, row.createdAt, cols.accessRestricted, cols.accessAllow]
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
      ...rowToKey(row),
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.allowedModels !== undefined ? { allowedModels: data.allowedModels } : {}),
      ...(data.blockedModels !== undefined ? { blockedModels: data.blockedModels } : {}),
      ...(data.allowedCombos !== undefined ? { allowedCombos: data.allowedCombos } : {}),
      ...(data.scopes !== undefined ? { scopes: data.scopes } : {}),
      ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
      ...(data.maxRequestsPerDay !== undefined ? { maxRequestsPerDay: data.maxRequestsPerDay } : {}),
      ...(data.maxSpendUsdPerDay !== undefined ? { maxSpendUsdPerDay: data.maxSpendUsdPerDay } : {}),
      access: accessForWrite(data, keyAccessFromColumns(row.accessRestricted, row.accessAllow)),
    };
    const r = keyToRow(merged);
    const cols = keyAccessToColumns(merged.access);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, allowedModels = ?, blockedModels = ?, allowedCombos = ?, scopes = ?, expiresAt = ?, maxRequestsPerDay = ?, maxSpendUsdPerDay = ?, accessRestricted = ?, accessAllow = ? WHERE id = ?`,
      [r.key, r.name, r.machineId, r.isActive, r.allowedModels, r.blockedModels, r.allowedCombos, r.scopes, r.expiresAt, r.maxRequestsPerDay, r.maxSpendUsdPerDay, cols.accessRestricted, cols.accessAllow, id]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
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
