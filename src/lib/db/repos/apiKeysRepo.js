import { writeKeyConnections } from "./keyConnectionsRepo.js";
import { publicText } from "../../../shared/utils/keyOwnership.js";
import { decryptKey, encryptKey } from "../helpers/keyEncryption.js";
import { v4 as uuidv4 } from "uuid";
import { requestLimits } from "../../../shared/utils/requestWindows.js";
import { admitKey } from "./keyAdmission.js";
import { getAdapter } from "../driver.js";
import { keyAccessFromColumns, keyAccessToColumns } from "@/shared/utils/keyAccess.js";

import { findVerifiedKey, keyVerifier } from "../helpers/keyVerifier.js";
import { rotateKey } from "./keyRotation.js";
import { generateApiKeyWithMachine } from "../../../shared/utils/apiKey.js";

export function keyMetadata(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, description: row.description, owner: row.owner, project: row.project, keyVersion: row.keyVersion, machineId: row.machineId,
    isActive: row.isActive, createdAt: row.createdAt, budget: row.budget,
    ...requestLimits(row), expiresAt: row.expiresAt, access: row.access,
  };
}

function rowToKey(db, row) {
  if (!row) return null;
  const key = row.key ?? decryptKey(db, row);
  return {
    id: row.id,
    key,
    ...(key === null && { keyError: "decryption_failed" }),
    keyVersion: row.key_version,
    allowedConnections: JSON.parse(row.allowedConnections ?? "[]"),
    name: row.name,
    description: row.description, owner: row.owner, project: row.project,
    machineId: row.machineId,
    isActive: key !== null && (row.isActive === 1 || row.isActive === true),
    createdAt: row.createdAt,
    budget: row.budget ? JSON.parse(row.budget) : null,
    ...requestLimits(row),
    expiresAt: row.expiresAt ?? null,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(row => rowToKey(db, row));
}

export async function getApiKeySummaries() {
  const db = await getAdapter();
  return db.all("SELECT id, name, owner, project, isActive, createdAt, expiresAt, key_version, key_ciphertext FROM apiKeys ORDER BY createdAt ASC")
    .map(row => ({
      id: row.id, name: publicText(row.name), owner: publicText(row.owner), project: publicText(row.project), createdAt: row.createdAt, expiresAt: row.expiresAt,
      isActive: Boolean(row.isActive) && decryptKey(db, row) !== null,
    }));
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(db, row);
}

// Used by the /v1 handlers to read the presented key's access settings.
export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = findVerifiedKey(db, key);
  if (!row) return null;
  return { ...rowToKey(db, row), connectionProviders: JSON.parse(row.connectionProviders ?? "{}") };
}

export async function createApiKey(name, machineId, policy = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const result = generateApiKeyWithMachine(machineId);
  const cols = keyAccessToColumns(policy.access);
  const apiKey = {
    id: uuidv4(),
    name,
    description: policy.description ?? null, owner: policy.owner ?? null, project: policy.project ?? null,
    key: result.key,
    keyVersion: 1,
    allowedConnections: policy.allowedConnections ?? [],
    machineId,
    budget: policy.budget ?? null,
    ...requestLimits(policy),
    expiresAt: policy.expiresAt ?? null,
    isActive: true,
    createdAt: new Date().toISOString(),
    access: keyAccessFromColumns(cols.accessRestricted, cols.accessAllow),
  };
  db.transaction(() => {
    db.run(
      `INSERT INTO apiKeys(id, key_ciphertext, key_verifier, name, machineId, isActive, createdAt, accessRestricted, accessAllow, rpmLimit, hourlyRequestLimit, dailyRequestLimit, monthlyRequestLimit, expiresAt, budget, description, owner, project) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [apiKey.id, encryptKey(db, apiKey.id, 1, apiKey.key), keyVerifier(apiKey.key), apiKey.name, apiKey.machineId, 1, apiKey.createdAt, cols.accessRestricted, cols.accessAllow, apiKey.rpmLimit, apiKey.hourlyRequestLimit, apiKey.dailyRequestLimit, apiKey.monthlyRequestLimit, apiKey.expiresAt, apiKey.budget ? JSON.stringify(apiKey.budget) : null, apiKey.description, apiKey.owner, apiKey.project]
    );
    if (policy.allowedConnections !== undefined) {
      writeKeyConnections(db, apiKey.id, policy.allowedConnections);
    }
  });
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    if (data.allowedConnections !== undefined) {
      writeKeyConnections(db, id, data.allowedConnections);
    }
    const merged = { ...rowToKey(db, row), ...data };
    const cols = keyAccessToColumns(merged.access);
    db.run(
      `UPDATE apiKeys SET name = ?, machineId = ?, isActive = ?, accessRestricted = ?, accessAllow = ?, rpmLimit = ?, hourlyRequestLimit = ?, dailyRequestLimit = ?, monthlyRequestLimit = ?, expiresAt = ?, budget = ?, description = ?, owner = ?, project = ? WHERE id = ?`,
      [merged.name, merged.machineId, merged.isActive ? 1 : 0, cols.accessRestricted, cols.accessAllow, merged.rpmLimit, merged.hourlyRequestLimit, merged.dailyRequestLimit, merged.monthlyRequestLimit, merged.expiresAt, merged.budget ? JSON.stringify(merged.budget) : null, merged.description, merged.owner, merged.project, id]
    );
    result = rowToKey(db, db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
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
  const row = findVerifiedKey(db, key);
  return row?.isActive === 1 && (row.expiresAt == null || row.expiresAt > new Date().toISOString());
}

export async function admitApiKey(key, pathname, consume = true) {
  return admitKey(await getAdapter(), key, Date.now(), pathname, consume);
}

export async function rotateApiKey(id, expectedVersion) {
  return rotateKey(await getAdapter(), id, expectedVersion);
}
