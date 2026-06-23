import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import {
  calculateExpiresAt,
  getRenewalBaseDate,
  isExpiredAt,
  normalizePlanMonths,
} from "@/lib/api-keys/plans.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    planMonths: row.planMonths === null || row.planMonths === undefined ? null : Number(row.planMonths),
    expiresAt: row.expiresAt || null,
    deactivatedReason: row.deactivatedReason || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
  };
}

function toNow(optionsNow = new Date()) {
  return optionsNow instanceof Date ? optionsNow : new Date(optionsNow);
}

function normalizePlanValue(planMonths) {
  if (planMonths === undefined || planMonths === null) return null;
  return normalizePlanMonths(planMonths);
}

function normalizeUpdateData(current, data, now) {
  const next = { ...current, ...data };

  if (Object.prototype.hasOwnProperty.call(data, "planMonths")) {
    next.planMonths = normalizePlanValue(data.planMonths);
  }

  if (Object.prototype.hasOwnProperty.call(data, "expiresAt")) {
    next.expiresAt = data.expiresAt || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, "deactivatedReason")) {
    next.deactivatedReason = data.deactivatedReason || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, "isActive")) {
    next.isActive = data.isActive === true;
  }

  if (next.isActive && isExpiredAt(next.expiresAt, now)) {
    next.isActive = false;
    next.deactivatedReason = "expired";
  } else if (next.isActive) {
    next.deactivatedReason = null;
  } else if (!next.deactivatedReason) {
    next.deactivatedReason = current.deactivatedReason || "manual";
  }

  return next;
}

async function expireApiKeys(db, now = new Date()) {
  const timestamp = toNow(now).toISOString();
  db.run(
    `UPDATE apiKeys
       SET isActive = 0,
           deactivatedReason = 'expired',
           updatedAt = ?
     WHERE expiresAt IS NOT NULL
       AND expiresAt <= ?
       AND isActive != 0`,
    [timestamp, timestamp]
  );
}

export async function getApiKeys(options = {}) {
  const db = await getAdapter();
  await expireApiKeys(db, options.now);
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id, options = {}) {
  const db = await getAdapter();
  await expireApiKeys(db, options.now);
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const now = toNow(options.now);
  const planMonths = normalizePlanValue(options.planMonths);
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    planMonths,
    expiresAt: planMonths ? calculateExpiresAt(planMonths, now) : null,
    deactivatedReason: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, planMonths, expiresAt, deactivatedReason, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      1,
      apiKey.planMonths,
      apiKey.expiresAt,
      apiKey.deactivatedReason,
      apiKey.createdAt,
      apiKey.updatedAt,
    ]
  );
  return apiKey;
}

export async function updateApiKey(id, data, options = {}) {
  const db = await getAdapter();
  let result = null;
  const now = toNow(options.now);
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = normalizeUpdateData(rowToKey(row), data, now);
    merged.updatedAt = now.toISOString();
    db.run(
      `UPDATE apiKeys
         SET key = ?,
             name = ?,
             machineId = ?,
             isActive = ?,
             planMonths = ?,
             expiresAt = ?,
             deactivatedReason = ?,
             updatedAt = ?
       WHERE id = ?`,
      [
        merged.key,
        merged.name,
        merged.machineId,
        merged.isActive ? 1 : 0,
        merged.planMonths,
        merged.expiresAt,
        merged.deactivatedReason,
        merged.updatedAt,
        id,
      ]
    );
    result = merged;
  });
  return result;
}

export async function renewApiKey(id, planMonths, now = new Date()) {
  const db = await getAdapter();
  let result = null;
  const renewalNow = toNow(now);
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;

    const current = rowToKey(row);
    const normalizedPlanMonths = normalizePlanMonths(planMonths);
    const baseDate = getRenewalBaseDate(current.expiresAt, renewalNow);
    const updatedAt = renewalNow.toISOString();
    const expiresAt = calculateExpiresAt(normalizedPlanMonths, baseDate);

    db.run(
      `UPDATE apiKeys
         SET key = ?,
             name = ?,
             machineId = ?,
             isActive = ?,
             planMonths = ?,
             expiresAt = ?,
             deactivatedReason = ?,
             updatedAt = ?
       WHERE id = ?`,
      [
        current.key,
        current.name,
        current.machineId,
        1,
        normalizedPlanMonths,
        expiresAt,
        null,
        updatedAt,
        id,
      ]
    );

    result = {
      ...current,
      isActive: true,
      planMonths: normalizedPlanMonths,
      expiresAt,
      deactivatedReason: null,
      updatedAt,
    };
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key, options = {}) {
  const db = await getAdapter();
  const now = toNow(options.now);
  await expireApiKeys(db, now);
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  const apiKey = rowToKey(row);
  return apiKey.isActive === true && !isExpiredAt(apiKey.expiresAt, now);
}
