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
    key: decryptKey(row.key),
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = await qAll(db, `SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = await qGet(db, `SELECT * FROM apiKeys WHERE id = ?`, [id]);
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
  await qRun(
    db,
    `INSERT INTO apiKeys(id, key, keyHash, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, encryptKey(apiKey.key), hashApiKey(apiKey.key), apiKey.name, apiKey.machineId, 1, apiKey.createdAt]
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
      `UPDATE apiKeys SET key = ?, keyHash = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [encryptKey(merged.key), hashApiKey(merged.key), merged.name, merged.machineId, merged.isActive ? 1 : 0, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = await qRun(db, `DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const h = hashApiKey(key);
  let row = await qGet(db, `SELECT isActive FROM apiKeys WHERE keyHash = ?`, [h]);
  if (!row) row = await qGet(db, `SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
