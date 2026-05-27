import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

const VALID_LIMIT_METRICS = new Set(["requests", "tokens", "cost"]);
const VALID_LIMIT_PERIODS = new Set(["daily", "monthly"]);

function normalizeLimitRow(row) {
  if (!row) return null;
  return {
    id: row.limitId,
    apiKeyId: row.id,
    metricType: row.metricType,
    periodType: row.periodType,
    limitValue: row.limitValue == null ? null : Number(row.limitValue),
    createdAt: row.limitCreatedAt,
    updatedAt: row.limitUpdatedAt,
  };
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    limit: normalizeLimitRow(row),
  };
}

function validateLimitInput(limit) {
  if (limit == null) return null;
  if (typeof limit !== "object") throw new Error("Invalid limit payload");

  const metricType = String(limit.metricType || "").trim();
  const periodType = String(limit.periodType || "").trim();
  const limitValue = Number(limit.limitValue);

  if (!VALID_LIMIT_METRICS.has(metricType)) {
    throw new Error("Invalid limit metric type");
  }
  if (!VALID_LIMIT_PERIODS.has(periodType)) {
    throw new Error("Invalid limit period type");
  }
  if (!Number.isFinite(limitValue) || limitValue <= 0) {
    throw new Error("Limit value must be greater than 0");
  }

  return {
    metricType,
    periodType,
    limitValue,
  };
}

async function upsertApiKeyLimit(db, apiKeyId, limit) {
  const existing = db.get(`SELECT id, createdAt FROM apiKeyLimits WHERE apiKeyId = ?`, [
    apiKeyId,
  ]);

  if (!limit) {
    if (existing) {
      db.run(`DELETE FROM apiKeyLimits WHERE apiKeyId = ?`, [apiKeyId]);
    }
    return null;
  }

  const now = new Date().toISOString();
  const limitId = existing?.id || uuidv4();
  const createdAt = existing?.createdAt || now;

  db.run(
    `INSERT INTO apiKeyLimits(id, apiKeyId, metricType, periodType, limitValue, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(apiKeyId) DO UPDATE SET
       metricType = excluded.metricType,
       periodType = excluded.periodType,
       limitValue = excluded.limitValue,
       updatedAt = excluded.updatedAt`,
    [
      limitId,
      apiKeyId,
      limit.metricType,
      limit.periodType,
      limit.limitValue,
      createdAt,
      now,
    ],
  );

  return {
    id: limitId,
    apiKeyId,
    metricType: limit.metricType,
    periodType: limit.periodType,
    limitValue: limit.limitValue,
    createdAt,
    updatedAt: now,
  };
}

function selectApiKeyBaseSql(whereClause = "", orderClause = "ORDER BY ak.createdAt ASC") {
  return `
    SELECT
      ak.id,
      ak.key,
      ak.name,
      ak.machineId,
      ak.isActive,
      ak.createdAt,
      akl.id AS limitId,
      akl.metricType,
      akl.periodType,
      akl.limitValue,
      akl.createdAt AS limitCreatedAt,
      akl.updatedAt AS limitUpdatedAt
    FROM apiKeys ak
    LEFT JOIN apiKeyLimits akl ON akl.apiKeyId = ak.id
    ${whereClause}
    ${orderClause}
  `;
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(selectApiKeyBaseSql());
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(selectApiKeyBaseSql(`WHERE ak.id = ?`, ""), [id]);
  return rowToKey(row);
}

export async function getApiKeyByValue(key) {
  const db = await getAdapter();
  const row = db.get(selectApiKeyBaseSql(`WHERE ak.key = ?`, ""), [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId, options = {}) {
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
  const normalizedLimit = validateLimitInput(options.limit);

  db.transaction(() => {
    db.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
      [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt],
    );
    upsertApiKeyLimit(db, apiKey.id, normalizedLimit);
  })();

  return await getApiKeyById(apiKey.id);
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = {
      ...row,
      key: data.key ?? row.key,
      name: data.name ?? row.name,
      machineId: data.machineId ?? row.machineId,
      isActive:
        data.isActive === undefined
          ? row.isActive === 1 || row.isActive === true
          : !!data.isActive,
    };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, id],
    );

    if (Object.prototype.hasOwnProperty.call(data, "limit")) {
      const normalizedLimit = validateLimitInput(data.limit);
      upsertApiKeyLimit(db, id, normalizedLimit);
    }

    result = true;
  })();

  if (!result) return null;
  return await getApiKeyById(id);
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const apiKey = await getApiKeyByValue(key);
  if (!apiKey) return false;
  return apiKey.isActive;
}

export async function getApiKeyValidationInfo(key) {
  const apiKey = await getApiKeyByValue(key);
  if (!apiKey) {
    return { valid: false, reason: "not_found", apiKey: null };
  }
  if (!apiKey.isActive) {
    return { valid: false, reason: "inactive", apiKey };
  }
  return { valid: true, reason: null, apiKey };
}
