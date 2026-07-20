import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

const RESERVATION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_STATUS_TOKENS = Number.MAX_SAFE_INTEGER;

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    dailyLimitTokens: row.dailyLimitTokens ?? null,
    createdAt: row.createdAt,
  };
}

export function normalizeDailyLimitTokens(value) {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === "string" && value.trim() === "")) return null;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("dailyLimitTokens must be a non-negative integer");
  return limit;
}

function getLocalDayStartIso(now = new Date()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function getLocalDayResetIso(now = new Date()) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.toISOString();
}

function toBoundedTokens(value) {
  const tokens = Number(value);
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  return Math.min(MAX_STATUS_TOKENS, Math.floor(tokens));
}

function getUsageTotals(db, key, apiKeyId, now) {
  // reasoning_tokens is a completion subset; max also preserves reasoning-only usage records.
  const row = db.get(
    `SELECT
       (SELECT TOTAL(MAX(COALESCE(promptTokens, 0), 0) + MAX(COALESCE(completionTokens, 0), COALESCE(json_extract(tokens, '$.reasoning_tokens'), 0), 0))
        FROM usageHistory WHERE apiKey = ? AND timestamp >= ?) AS usedTokens,
       (SELECT TOTAL(MAX(reservedTokens, 0))
        FROM apiKeyUsageReservations WHERE apiKeyId = ? AND expiresAt > ?) AS reservedTokens`,
    [key, getLocalDayStartIso(now), apiKeyId, new Date(now).toISOString()]
  );
  return {
    usedTokens: toBoundedTokens(row?.usedTokens),
    reservedTokens: toBoundedTokens(row?.reservedTokens),
  };
}

function getRemainingTokens(limitTokens, usedTokens, reservedTokens) {
  return Math.max(0, Math.max(0, limitTokens - usedTokens) - reservedTokens);
}

function unenforcedReservationStatus(requestedTokens, resetAt) {
  return {
    enforced: false,
    accepted: true,
    reservationId: null,
    usedTokens: 0,
    reservedTokens: 0,
    requestedTokens,
    limitTokens: null,
    remainingTokens: null,
    resetAt,
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

export async function createApiKey(name, machineId, dailyLimitTokens = null) {
  if (!machineId) throw new Error("machineId is required");
  const tokenLimit = normalizeDailyLimitTokens(dailyLimitTokens);
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    dailyLimitTokens: tokenLimit ?? null,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, dailyLimitTokens, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.dailyLimitTokens, apiKey.createdAt]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const cleanData = { ...data };
    if ("dailyLimitTokens" in cleanData) cleanData.dailyLimitTokens = normalizeDailyLimitTokens(cleanData.dailyLimitTokens);
    const merged = { ...rowToKey(row), ...cleanData };
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, dailyLimitTokens = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, merged.dailyLimitTokens ?? null, id]
    );
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  return db.transaction(() => {
    db.run(`DELETE FROM apiKeyUsageReservations WHERE apiKeyId = ?`, [id]);
    const result = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
    return (result?.changes ?? 0) > 0;
  });
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}

export async function reserveApiKeyUsage(key, requestedTokens, now = new Date()) {
  if (!Number.isSafeInteger(requestedTokens) || requestedTokens <= 0) {
    throw new Error("requestedTokens must be a positive safe integer");
  }

  const db = await getAdapter();
  const nowDate = new Date(now);
  const nowIso = nowDate.toISOString();
  const resetAt = getLocalDayResetIso(nowDate);

  return db.transaction(() => {
    db.run(`DELETE FROM apiKeyUsageReservations WHERE expiresAt <= ?`, [nowIso]);

    const row = db.get(`SELECT id, isActive, dailyLimitTokens FROM apiKeys WHERE key = ?`, [key]);
    if (!row || !(row.isActive === 1 || row.isActive === true)) {
      return unenforcedReservationStatus(requestedTokens, resetAt);
    }

    const limitTokens = normalizeDailyLimitTokens(row.dailyLimitTokens);
    if (limitTokens === null || limitTokens === undefined) {
      return unenforcedReservationStatus(requestedTokens, resetAt);
    }

    const { usedTokens, reservedTokens: activeReservedTokens } = getUsageTotals(db, key, row.id, nowDate);
    const remainingBeforeRequest = getRemainingTokens(limitTokens, usedTokens, activeReservedTokens);
    const accepted = requestedTokens <= remainingBeforeRequest;
    const reservationId = accepted ? uuidv4() : null;
    const reservedTokens = accepted ? activeReservedTokens + requestedTokens : activeReservedTokens;

    if (accepted) {
      const expiresAt = new Date(nowDate.getTime() + RESERVATION_TTL_MS).toISOString();
      db.run(
        `INSERT INTO apiKeyUsageReservations(id, apiKeyId, reservedTokens, createdAt, expiresAt) VALUES(?, ?, ?, ?, ?)`,
        [reservationId, row.id, requestedTokens, nowIso, expiresAt]
      );
    }

    return {
      enforced: true,
      accepted,
      reservationId,
      usedTokens,
      reservedTokens,
      requestedTokens,
      limitTokens,
      remainingTokens: getRemainingTokens(limitTokens, usedTokens, reservedTokens),
      resetAt,
    };
  });
}

export async function releaseApiKeyUsageReservation(id) {
  if (!id) return false;
  const db = await getAdapter();
  return db.transaction(() => {
    const result = db.run(`DELETE FROM apiKeyUsageReservations WHERE id = ?`, [id]);
    return (result?.changes ?? 0) > 0;
  });
}

export async function getApiKeyUsageLimitStatus(key, now = new Date()) {
  if (!key) return { enforced: false, exceeded: false };
  const db = await getAdapter();
  const row = db.get(`SELECT id, isActive, dailyLimitTokens FROM apiKeys WHERE key = ?`, [key]);
  if (!row || !(row.isActive === 1 || row.isActive === true)) return { enforced: false, exceeded: false };
  const limit = normalizeDailyLimitTokens(row.dailyLimitTokens);
  if (limit === null || limit === undefined) return { enforced: false, exceeded: false };
  const nowDate = new Date(now);
  const { usedTokens, reservedTokens } = getUsageTotals(db, key, row.id, nowDate);
  const remainingTokens = getRemainingTokens(limit, usedTokens, reservedTokens);
  return {
    enforced: true,
    exceeded: remainingTokens === 0,
    usedTokens,
    reservedTokens,
    limitTokens: limit,
    remainingTokens,
    resetAt: getLocalDayResetIso(nowDate),
  };
}
