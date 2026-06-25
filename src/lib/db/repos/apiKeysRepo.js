import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

export const API_KEY_LIMIT_MODES = new Set(["unlimited", "daily", "weekly", "daily_weekly", "hard"]);

function toIntOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function normalizeLimitMode(value) {
  const mode = typeof value === "string" ? value.toLowerCase() : "unlimited";
  return API_KEY_LIMIT_MODES.has(mode) ? mode : "unlimited";
}

function normalizeExpiresAt(value, now = Date.now()) {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function expiryFromDurationMs(durationMs) {
  const n = Number(durationMs);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.now() + Math.floor(n)).toISOString();
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    limitMode: normalizeLimitMode(row.limitMode),
    tokenLimit: toIntOrNull(row.tokenLimit),
    dailyTokenLimit: toIntOrNull(row.dailyTokenLimit),
    weeklyTokenLimit: toIntOrNull(row.weeklyTokenLimit),
    expiresAt: row.expiresAt || null,
    autoDeleteExpired: row.autoDeleteExpired === undefined || row.autoDeleteExpired === null
      ? true
      : row.autoDeleteExpired === 1 || row.autoDeleteExpired === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
  };
}

function getDayWindow(now) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start, end };
}

function getWeekWindow(now) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

function getUsageResetWindow(period, key, now = new Date()) {
  if (period === "daily") return getDayWindow(now);
  if (period === "weekly") return getWeekWindow(now);
  return {
    start: null,
    end: null,
  };
}

function limitSummary(usage, limit, window = {}) {
  const normalizedLimit = toIntOrNull(limit);
  const remaining = normalizedLimit === null ? null : Math.max(0, normalizedLimit - usage.tokens);
  const remainingPercentage = normalizedLimit === null
    ? null
    : Math.max(0, Math.min(100, Math.round((remaining / normalizedLimit) * 100)));
  return {
    limit: normalizedLimit,
    used: usage.tokens,
    requests: usage.requests,
    remaining,
    remainingPercentage,
    windowStart: window.start ? window.start.toISOString() : null,
    resetAt: window.end ? window.end.toISOString() : null,
    lastUsedAt: usage.lastUsedAt,
    exhausted: normalizedLimit !== null && usage.tokens >= normalizedLimit,
  };
}

function mostConstrainedLimit(...limits) {
  const bounded = limits.filter((limit) => limit?.limit !== null);
  if (!bounded.length) return null;
  return bounded.sort((a, b) => (a.remainingPercentage ?? 100) - (b.remainingPercentage ?? 100))[0];
}

function sumUsage(db, apiKey, start = null, end = null) {
  const where = ["apiKey = ?"];
  const params = [apiKey];
  if (start) {
    where.push("timestamp >= ?");
    params.push(start.toISOString());
  }
  if (end) {
    where.push("timestamp < ?");
    params.push(end.toISOString());
  }
  const row = db.get(
    `SELECT COALESCE(SUM(COALESCE(promptTokens, 0) + COALESCE(completionTokens, 0)), 0) AS tokens,
            COUNT(*) AS requests,
            MAX(timestamp) AS lastUsedAt
       FROM usageHistory
      WHERE ${where.join(" AND ")}`,
    params,
  );
  return {
    tokens: Number(row?.tokens || 0),
    requests: Number(row?.requests || 0),
    lastUsedAt: row?.lastUsedAt || null,
  };
}

function buildUsageSummary(db, key, now = new Date()) {
  const total = sumUsage(db, key.key, null, null);
  const dailyWindow = getDayWindow(now);
  const weeklyWindow = getWeekWindow(now);
  const daily = sumUsage(db, key.key, dailyWindow.start, dailyWindow.end);
  const weekly = sumUsage(db, key.key, weeklyWindow.start, weeklyWindow.end);
  const hard = total;
  const dailyLimit = key.limitMode === "daily_weekly"
    ? key.dailyTokenLimit
    : key.limitMode === "daily"
      ? key.tokenLimit
      : null;
  const weeklyLimit = key.limitMode === "daily_weekly"
    ? key.weeklyTokenLimit
    : key.limitMode === "weekly"
      ? key.tokenLimit
      : null;
  const hardLimit = key.limitMode === "hard" ? key.tokenLimit : null;
  const limits = {
    daily: limitSummary(daily, dailyLimit, dailyWindow),
    weekly: limitSummary(weekly, weeklyLimit, weeklyWindow),
    hard: limitSummary(hard, hardLimit),
  };
  const activeLimit = key.limitMode === "daily"
    ? limits.daily
    : key.limitMode === "weekly"
      ? limits.weekly
      : key.limitMode === "hard"
        ? limits.hard
        : key.limitMode === "daily_weekly"
          ? mostConstrainedLimit(limits.daily, limits.weekly)
          : null;

  return {
    mode: key.limitMode,
    limit: activeLimit?.limit ?? null,
    used: activeLimit?.used ?? total.tokens,
    requests: activeLimit?.requests ?? total.requests,
    totalUsed: total.tokens,
    totalRequests: total.requests,
    periods: {
      allTime: {
        used: total.tokens,
        requests: total.requests,
        lastUsedAt: total.lastUsedAt,
      },
      daily: {
        used: daily.tokens,
        requests: daily.requests,
        windowStart: dailyWindow.start.toISOString(),
        resetAt: dailyWindow.end.toISOString(),
        lastUsedAt: daily.lastUsedAt,
      },
      weekly: {
        used: weekly.tokens,
        requests: weekly.requests,
        windowStart: weeklyWindow.start.toISOString(),
        resetAt: weeklyWindow.end.toISOString(),
        lastUsedAt: weekly.lastUsedAt,
      },
    },
    limits,
    remaining: activeLimit?.remaining ?? null,
    remainingPercentage: activeLimit?.remainingPercentage ?? null,
    windowStart: activeLimit?.windowStart ?? null,
    resetAt: activeLimit?.resetAt ?? null,
    lastUsedAt: activeLimit?.lastUsedAt || total.lastUsedAt,
    exhausted: limits.daily.exhausted || limits.weekly.exhausted || limits.hard.exhausted,
  };
}

function getKeyStatus(key, usage, now = new Date()) {
  if (!key.isActive) return "paused";
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= now.getTime()) return "expired";
  if (usage.exhausted || (usage.limit !== null && usage.used >= usage.limit)) return "exhausted";
  return "active";
}

async function hydrateKey(db, row, includeUsage = false, now = new Date()) {
  const key = rowToKey(row);
  if (!key) return null;
  if (!includeUsage) return key;
  const usage = buildUsageSummary(db, key, now);
  return { ...key, usage, status: getKeyStatus(key, usage, now) };
}

function buildKeyConfig(input = {}, existing = {}) {
  const limitMode = normalizeLimitMode(input.limitMode ?? existing.limitMode);
  const dailyTokenLimit = limitMode === "daily_weekly"
    ? toIntOrNull(input.dailyTokenLimit ?? existing.dailyTokenLimit ?? existing.tokenLimit)
    : toIntOrNull(input.dailyTokenLimit ?? existing.dailyTokenLimit);
  const weeklyTokenLimit = limitMode === "daily_weekly"
    ? toIntOrNull(input.weeklyTokenLimit ?? existing.weeklyTokenLimit ?? existing.tokenLimit)
    : toIntOrNull(input.weeklyTokenLimit ?? existing.weeklyTokenLimit);
  const tokenLimit = limitMode === "unlimited" || limitMode === "daily_weekly"
    ? null
    : toIntOrNull(input.tokenLimit ?? existing.tokenLimit);
  const expiresAt = Object.prototype.hasOwnProperty.call(input, "expiresInMs")
    ? expiryFromDurationMs(input.expiresInMs)
    : Object.prototype.hasOwnProperty.call(input, "expiresAt")
      ? normalizeExpiresAt(input.expiresAt)
      : (existing.expiresAt || null);
  const autoDeleteExpired = Object.prototype.hasOwnProperty.call(input, "autoDeleteExpired")
    ? input.autoDeleteExpired !== false
    : (existing.autoDeleteExpired !== false);

  return { limitMode, tokenLimit, dailyTokenLimit, weeklyTokenLimit, expiresAt, autoDeleteExpired };
}

export async function cleanupExpiredApiKeys(now = new Date()) {
  const db = await getAdapter();
  const res = db.run(
    `DELETE FROM apiKeys
      WHERE autoDeleteExpired = 1
        AND expiresAt IS NOT NULL
        AND expiresAt != ''
        AND expiresAt <= ?`,
    [now.toISOString()],
  );
  return res?.changes ?? 0;
}

export async function getApiKeys(options = {}) {
  const db = await getAdapter();
  await cleanupExpiredApiKeys();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return Promise.all(rows.map((row) => hydrateKey(db, row, options.includeUsage === true)));
}

export async function getApiKeyById(id, options = {}) {
  const db = await getAdapter();
  await cleanupExpiredApiKeys();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return hydrateKey(db, row, options.includeUsage === true);
}

export async function createApiKey(name, machineId, options = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const now = new Date().toISOString();
  const config = buildKeyConfig(options);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    ...config,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, limitMode, tokenLimit, dailyTokenLimit, weeklyTokenLimit, expiresAt, autoDeleteExpired, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1,
      apiKey.limitMode, apiKey.tokenLimit, apiKey.dailyTokenLimit, apiKey.weeklyTokenLimit, apiKey.expiresAt,
      apiKey.autoDeleteExpired ? 1 : 0, apiKey.createdAt, apiKey.updatedAt,
    ],
  );
  return { ...apiKey, usage: buildUsageSummary(db, apiKey), status: "active" };
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const existing = rowToKey(row);
    const config = buildKeyConfig(data, existing);
    const merged = {
      ...existing,
      ...data,
      ...config,
      isActive: data.isActive !== undefined ? data.isActive === true : existing.isActive,
      updatedAt: new Date().toISOString(),
    };
    db.run(
      `UPDATE apiKeys
          SET key = ?, name = ?, machineId = ?, isActive = ?, limitMode = ?,
              tokenLimit = ?, dailyTokenLimit = ?, weeklyTokenLimit = ?,
              expiresAt = ?, autoDeleteExpired = ?, updatedAt = ?
        WHERE id = ?`,
      [
        merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0,
        merged.limitMode, merged.tokenLimit, merged.dailyTokenLimit, merged.weeklyTokenLimit, merged.expiresAt,
        merged.autoDeleteExpired ? 1 : 0, merged.updatedAt, id,
      ],
    );
    const usage = buildUsageSummary(db, merged);
    result = { ...merged, usage, status: getKeyStatus(merged, usage) };
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

function rebuildUsageDaily(db) {
  db.run(`DELETE FROM usageDaily`);
  const rows = db.all(`SELECT timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens FROM usageHistory ORDER BY id ASC`);
  const days = new Map();

  for (const row of rows) {
    const d = new Date(row.timestamp);
    if (!Number.isFinite(d.getTime())) continue;
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (!days.has(dateKey)) {
      days.set(dateKey, {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        byProvider: {},
        byModel: {},
        byAccount: {},
        byApiKey: {},
        byEndpoint: {},
      });
    }
    const day = days.get(dateKey);
    const promptTokens = Number(row.promptTokens || 0);
    const completionTokens = Number(row.completionTokens || 0);
    const cost = Number(row.cost || 0);
    const values = { requests: 1, promptTokens, completionTokens, cost };

    day.requests += 1;
    day.promptTokens += promptTokens;
    day.completionTokens += completionTokens;
    day.cost += cost;

    const add = (target, key, extra = {}) => {
      if (!key) return;
      if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0, ...extra };
      target[key].requests += values.requests;
      target[key].promptTokens += values.promptTokens;
      target[key].completionTokens += values.completionTokens;
      target[key].cost += values.cost;
    };

    add(day.byProvider, row.provider);
    add(day.byModel, row.provider ? `${row.model}|${row.provider}` : row.model, { rawModel: row.model, provider: row.provider });
    add(day.byAccount, row.connectionId, { rawModel: row.model, provider: row.provider });
    const apiKeyValue = row.apiKey || "local-no-key";
    add(day.byApiKey, `${apiKeyValue}|${row.model}|${row.provider || "unknown"}`, { rawModel: row.model, provider: row.provider, apiKey: row.apiKey || null });
    const endpoint = row.endpoint || "Unknown";
    add(day.byEndpoint, `${endpoint}|${row.model}|${row.provider || "unknown"}`, { endpoint, rawModel: row.model, provider: row.provider });
  }

  for (const [dateKey, data] of days) {
    db.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [dateKey, JSON.stringify(data)]);
  }
}

export async function resetApiKeyUsage(id, period = "all") {
  const normalizedPeriod = ["all", "daily", "weekly"].includes(period) ? period : "all";
  const db = await getAdapter();
  let result = null;

  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    const key = rowToKey(row);
    if (!key) return;

    const { start, end } = getUsageResetWindow(normalizedPeriod, key);
    const where = ["apiKey = ?"];
    const params = [key.key];
    if (start) {
      where.push("timestamp >= ?");
      params.push(start.toISOString());
    }
    if (end) {
      where.push("timestamp < ?");
      params.push(end.toISOString());
    }

    const res = db.run(`DELETE FROM usageHistory WHERE ${where.join(" AND ")}`, params);
    rebuildUsageDaily(db);
    const usage = buildUsageSummary(db, key);
    result = {
      deleted: res?.changes ?? 0,
      period: normalizedPeriod,
      key: { ...key, usage, status: getKeyStatus(key, usage) },
    };
  });

  return result;
}

export async function getApiKeyUsageSummary(keyValue) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [keyValue]);
  const key = rowToKey(row);
  if (!key) return null;
  const usage = buildUsageSummary(db, key);
  return { ...usage, status: getKeyStatus(key, usage) };
}

export async function checkApiKeyAccess(keyValue) {
  if (!keyValue) return { valid: false, reason: "missing" };
  const db = await getAdapter();
  await cleanupExpiredApiKeys();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [keyValue]);
  const key = rowToKey(row);
  if (!key) return { valid: false, reason: "invalid" };

  const now = new Date();
  const usage = buildUsageSummary(db, key, now);
  const status = getKeyStatus(key, usage, now);

  if (status === "paused") return { valid: false, reason: "paused", key, usage, status };
  if (status === "expired") return { valid: false, reason: "expired", key, usage, status };
  if (status === "exhausted") {
    return {
      valid: false,
      reason: "token_limit_exceeded",
      key,
      usage,
      status,
      resetAt: usage.resetAt,
    };
  }

  return { valid: true, reason: "ok", key, usage, status };
}

export async function validateApiKey(key) {
  const access = await checkApiKeyAccess(key);
  return access.valid === true;
}
