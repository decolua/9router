import { qAll, qGet, qRun } from "../query.js";
import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { isMasterKeyConfigured } from "../../crypto/masterKey.js";
import { encryptString, decryptString } from "../helpers/encryptedJsonCol.js";
import { getRuntimeUserId } from "../../auth/runtimeUserContext.js";
import { resolveOrgId, tenantFilters, tenantFiltersSync } from "../helpers/orgScope.js";

const API_KEY_HASH_DOMAIN = "ebrouter-apikey-hash:";

function hashApiKey(plaintext) {
  if (!plaintext) return null;
  const h = crypto.createHash("sha256");
  h.update(API_KEY_HASH_DOMAIN);
  h.update(String(plaintext));
  return h.digest("hex");
}

function encryptKey(plaintext) {
  if (plaintext == null) return plaintext;
  return isMasterKeyConfigured() ? encryptString(plaintext) : plaintext;
}

function decryptKey(stored) {
  if (stored == null) return stored;
  if (!isMasterKeyConfigured()) return stored;
  try { return decryptString(stored); } catch { return stored; }
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    orgId: row.orgId || null,
    userId: row.userId || null,
    key: decryptKey(row.key),
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
}

export async function getApiKeys(userId, orgId) {
  const db = await getAdapter();
  const { conds, params } = await tenantFilters({ orgId, userId: userId || getRuntimeUserId() });
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = await qAll(db, `SELECT * FROM apiKeys ${where} ORDER BY createdAt ASC`, params);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id, userId = null, orgId = null) {
  const db = await getAdapter();
  const { conds, params } = await tenantFilters({ orgId, userId });
  conds.push("id = ?");
  params.push(id);
  const row = await qGet(db, `SELECT * FROM apiKeys WHERE ${conds.join(" AND ")}`, params);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, userId, orgId) {
  const scopedUser = userId || getRuntimeUserId();
  const scopedOrg = await resolveOrgId(orgId);
  if (!machineId) throw new Error("machineId is required");
  if (!scopedUser) throw new Error("userId is required");
  if (!scopedOrg) throw new Error("orgId is required");

  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    orgId: scopedOrg,
    userId: scopedUser,
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  await qRun(
    db,
    `INSERT INTO apiKeys(id, orgId, userId, key, keyHash, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.orgId, apiKey.userId, encryptKey(apiKey.key), hashApiKey(apiKey.key), apiKey.name, apiKey.machineId, 1, apiKey.createdAt],
  );
  return apiKey;
}

export async function updateApiKey(id, data, userId = null, orgId = null) {
  const db = await getAdapter();
  const { conds, params } = await tenantFilters({ orgId, userId });
  conds.push("id = ?");
  params.push(id);
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE ${conds.join(" AND ")}`, params);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, keyHash = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [encryptKey(merged.key), hashApiKey(merged.key), merged.name, merged.machineId, merged.isActive ? 1 : 0, id],
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id, userId = null, orgId = null) {
  const db = await getAdapter();
  const { conds, params } = await tenantFilters({ orgId, userId });
  conds.push("id = ?");
  params.push(id);
  const res = await qRun(db, `DELETE FROM apiKeys WHERE ${conds.join(" AND ")}`, params);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const h = hashApiKey(key);
  let row = await qGet(db, `SELECT isActive, userId, orgId FROM apiKeys WHERE keyHash = ?`, [h]);
  if (!row) row = await qGet(db, `SELECT isActive, userId, orgId FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  const active = row.isActive === 1 || row.isActive === true;
  if (!active) return false;
  if (!row.userId) return { valid: true, userId: null, orgId: row.orgId || null };
  return { valid: true, userId: row.userId, orgId: row.orgId || null };
}

export async function isApiKeyValid(key) {
  const result = await validateApiKey(key);
  return result === true || result?.valid === true;
}

export async function resolveApiKeyUserId(key) {
  const result = await validateApiKey(key);
  if (!result) return null;
  if (result === true) return null;
  return result.userId || null;
}

export async function resolveApiKeyOrgId(key) {
  const result = await validateApiKey(key);
  if (!result) return null;
  if (result === true) return null;
  return result.orgId || null;
}

export async function resolveApiKeyContext(key) {
  const result = await validateApiKey(key);
  if (!result) return null;
  if (result === true) return { userId: null, orgId: await resolveOrgId() };
  return { userId: result.userId || null, orgId: result.orgId || (await resolveOrgId()) };
}
