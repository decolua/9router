import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import {
  calculateExpiresAt,
  getRenewalBaseDate,
  isExpiredAt,
  normalizePlanMonths,
} from "../../api-keys/plans.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: normalizeBooleanFlag(row.isActive),
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

function normalizeBooleanFlag(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0" || normalized === "") return false;
  }
  throw new Error("isActive must be a boolean-like value");
}

function normalizeMutableBooleanFlag(value, fieldName) {
  if (value === undefined) return undefined;
  try {
    return normalizeBooleanFlag(value);
  } catch {
    throw new Error(`${fieldName} must be true, false, 1, 0, "true", or "false"`);
  }
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
    next.isActive = normalizeMutableBooleanFlag(data.isActive, "isActive");
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

function getRowVersion(row) {
  return row.updatedAt || row.createdAt || "";
}

function buildMonotonicUpdatedAt(baseNow, rowVersion) {
  const candidate = toNow(baseNow);
  const previous = rowVersion ? new Date(rowVersion) : null;
  if (!previous || Number.isNaN(previous.getTime())) {
    return candidate.toISOString();
  }
  if (candidate.getTime() > previous.getTime()) {
    return candidate.toISOString();
  }
  return new Date(previous.getTime() + 1).toISOString();
}

function updateApiKeyRecord(db, next, expectedVersion) {
  return db.run(
    `UPDATE apiKeys
       SET key = ?,
           name = ?,
           machineId = ?,
           isActive = ?,
           planMonths = ?,
           expiresAt = ?,
           deactivatedReason = ?,
           updatedAt = ?
     WHERE id = ?
       AND COALESCE(updatedAt, createdAt) = ?`,
    [
      next.key,
      next.name,
      next.machineId,
      next.isActive ? 1 : 0,
      next.planMonths,
      next.expiresAt,
      next.deactivatedReason,
      next.updatedAt,
      next.id,
      expectedVersion,
    ]
  );
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
       AND isActive = 1`,
    [timestamp, timestamp]
  );
}

function expireApiKeyRow(db, row, now = new Date()) {
  const current = rowToKey(row);
  if (!current || !current.isActive || !isExpiredAt(current.expiresAt, now)) return current;

  const timestamp = toNow(now).toISOString();
  const update = updateApiKeyRecord(db, {
    ...current,
    isActive: false,
    deactivatedReason: "expired",
    updatedAt: timestamp,
  }, getRowVersion(row));

  if ((update?.changes ?? 0) > 0) {
    return {
      ...current,
      isActive: false,
      deactivatedReason: "expired",
      updatedAt: timestamp,
    };
  }

  const refreshed = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [current.id]);
  return rowToKey(refreshed);
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
    const update = updateApiKeyRecord(db, { ...merged, id }, getRowVersion(row));
    if ((update?.changes ?? 0) > 0) {
      result = merged;
      return;
    }
    const refreshed = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    result = rowToKey(refreshed);
  });
  return result;
}

export async function renewApiKey(id, planMonths, now = new Date()) {
  const db = await getAdapter();
  const renewalNow = toNow(now);
  const normalizedPlanMonths = normalizePlanMonths(planMonths);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let result = null;
    let conflict = false;

    db.transaction(() => {
      const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
      if (!row) return;

      const current = rowToKey(row);
      const updatedAt = buildMonotonicUpdatedAt(renewalNow, getRowVersion(row));
      const expiresAt = calculateExpiresAt(
        normalizedPlanMonths,
        getRenewalBaseDate(current.expiresAt, renewalNow)
      );
      const next = {
        ...current,
        isActive: true,
        planMonths: normalizedPlanMonths,
        expiresAt,
        deactivatedReason: null,
        updatedAt,
      };
      const update = updateApiKeyRecord(db, next, getRowVersion(row));

      if ((update?.changes ?? 0) > 0) {
        result = next;
      } else {
        conflict = true;
      }
    });

    if (result) return result;
    if (!conflict) return null;
  }

  throw new Error("Failed to renew API key due to concurrent updates");
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key, options = {}) {
  const db = await getAdapter();
  const now = toNow(options.now);
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  const apiKey = expireApiKeyRow(db, row, now);
  if (!apiKey) return false;
  return apiKey.isActive === true && !isExpiredAt(apiKey.expiresAt, now);
}
