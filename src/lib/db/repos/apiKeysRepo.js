import { qAll, qGet, qRun } from "../query.js";
import { v4 as uuidv4 } from "uuid";
import crypto from "node:crypto";
import { getAdapter } from "../driver.js";
import { isMasterKeyConfigured } from "../../crypto/masterKey.js";
import { encryptString, decryptString } from "../helpers/encryptedJsonCol.js";

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
    userId: row.userId || null,
    key: decryptKey(row.key),
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
}

import { getRuntimeUserId } from "../../auth/runtimeUserContext.js";

export async function getApiKeys(userId) {
  const db = await getAdapter();
  const scoped = userId || getRuntimeUserId() || null;
  const rows = scoped
    ? await qAll(db, `SELECT * FROM apiKeys WHERE userId = ? ORDER BY createdAt ASC`, [scoped])
    : await qAll(db, `SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id, userId = null) {
  const db = await getAdapter();
  const row = userId
    ? await qGet(db, `SELECT * FROM apiKeys WHERE id = ? AND userId = ?`, [id, userId])
    : await qGet(db, `SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, userId) {
  const scoped = userId || getRuntimeUserId();
  if (!machineId) throw new Error("machineId is required");
  if (!scoped) throw new Error("userId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    userId: scoped,
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
  };
  await qRun(
    db,
    `INSERT INTO apiKeys(id, userId, key, keyHash, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, scoped, encryptKey(apiKey.key), hashApiKey(apiKey.key), apiKey.name, apiKey.machineId, 1, apiKey.createdAt]
  );
  return { ...apiKey, userId: scoped };
}

export async function updateApiKey(id, data, userId = null) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = userId
      ? db.get(`SELECT * FROM apiKeys WHERE id = ? AND userId = ?`, [id, userId])
      : db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    db.run(
      `UPDATE apiKeys SET key = ?, keyHash = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [encryptKey(merged.key), hashApiKey(merged.key), merged.name, merged.machineId, merged.isActive ? 1 : 0, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id, userId = null) {
  const db = await getAdapter();
  const res = userId
    ? await qRun(db, `DELETE FROM apiKeys WHERE id = ? AND userId = ?`, [id, userId])
    : await qRun(db, `DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const h = hashApiKey(key);
  let row = await qGet(db, `SELECT isActive, userId FROM apiKeys WHERE keyHash = ?`, [h]);
  if (!row) row = await qGet(db, `SELECT isActive, userId FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  const active = row.isActive === 1 || row.isActive === true;
  if (!active) return false;
  if (!row.userId) return { valid: true, userId: null };
  return { valid: true, userId: row.userId };
}

/** Backward-compatible boolean check. */
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
