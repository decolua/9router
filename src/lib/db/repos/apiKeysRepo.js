import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { keyAccessFromColumns, keyAccessToColumns } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";
import { isKeyExpired, KEY_QUOTA_PERIODS, FIVE_HOURS_MS, quotaPeriodBounds } from "@/shared/utils/keyQuota.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
    expiresAt: row.expiresAt ?? null,
    quota5hUsd: row.quota5hUsd ?? null,
    quotaWeeklyUsd: row.quotaWeeklyUsd ?? null,
    quotaMonthlyUsd: row.quotaMonthlyUsd ?? null,
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

export async function createApiKey(name, machineId, limits = {}) {
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
    access: { restricted: false, allow: [] },
    expiresAt: limits.expiresAt ?? null,
    quota5hUsd: limits.quota5hUsd ?? null,
    quotaWeeklyUsd: limits.quotaWeeklyUsd ?? null,
    quotaMonthlyUsd: limits.quotaMonthlyUsd ?? null,
  };
  const cols = keyAccessToColumns(KEY_ACCESS_UNRESTRICTED);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow, expiresAt, quota5hUsd, quotaWeeklyUsd, quotaMonthlyUsd) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, cols.accessRestricted, cols.accessAllow,
      apiKey.expiresAt, apiKey.quota5hUsd, apiKey.quotaWeeklyUsd, apiKey.quotaMonthlyUsd]
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
    const cols = keyAccessToColumns(merged.access);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, accessRestricted = ?, accessAllow = ?, expiresAt = ?, quota5hUsd = ?, quotaWeeklyUsd = ?, quotaMonthlyUsd = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, cols.accessRestricted, cols.accessAllow,
        merged.expiresAt ?? null, merged.quota5hUsd ?? null, merged.quotaWeeklyUsd ?? null, merged.quotaMonthlyUsd ?? null, id]
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
  const row = db.get(`SELECT isActive, expiresAt FROM apiKeys WHERE key = ?`, [key]);
  if (!row || isKeyExpired(row)) return false;
  return row.isActive === 1 || row.isActive === true;
}

// USD spent by `key` in the rolling 5h window and the current week / month,
// plus when each frees up: { "5h": { spent, start, end }, week, month }. One
// query. The 5h window frees up as its oldest request ages out, so its `end`
// is that request's time + 5h (now + 5h when the window is empty).
export async function getApiKeyPeriodSpend(key, now = new Date()) {
  const db = await getAdapter();
  const bounds = Object.fromEntries(KEY_QUOTA_PERIODS.map((p) => [p.id, quotaPeriodBounds(p.id, now)]));
  const earliest = new Date(Math.min(...Object.values(bounds).map((b) => b.start.getTime())));
  const fiveStart = bounds["5h"].start.toISOString();
  const row = db.get(
    `SELECT
       COALESCE(SUM(CASE WHEN timestamp >= ? THEN cost END), 0) AS h5,
       MIN(CASE WHEN timestamp >= ? THEN timestamp END) AS h5Oldest,
       COALESCE(SUM(CASE WHEN timestamp >= ? THEN cost END), 0) AS week,
       COALESCE(SUM(CASE WHEN timestamp >= ? THEN cost END), 0) AS month
     FROM usageHistory WHERE apiKey = ? AND timestamp >= ?`,
    [fiveStart, fiveStart, bounds.week.start.toISOString(), bounds.month.start.toISOString(), key, earliest.toISOString()]
  );
  if (row?.h5Oldest) bounds["5h"].end = new Date(new Date(row.h5Oldest).getTime() + FIVE_HOURS_MS);
  return {
    "5h": { spent: row?.h5 || 0, ...bounds["5h"] },
    week: { spent: row?.week || 0, ...bounds.week },
    month: { spent: row?.month || 0, ...bounds.month },
  };
}

// Usage report for one key over the last `days` days: totals, a per-day series
// (local dates, zero-filled) and a per-model breakdown sorted by cost.
export async function getApiKeyUsageReport(key, days = 30, now = new Date()) {
  const db = await getAdapter();
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  // ponytail: aggregates in JS over the key's raw rows; move to GROUP BY if a key logs millions of requests per range.
  const rows = db.all(
    `SELECT timestamp, provider, model, promptTokens, completionTokens, cost
     FROM usageHistory WHERE apiKey = ? AND timestamp >= ?`,
    [key, since.toISOString()]
  );
  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const daily = new Map();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getFullYear(), since.getMonth(), since.getDate() + i);
    daily.set(dayKey(d), { date: dayKey(d), requests: 0, tokens: 0, cost: 0 });
  }
  const byModel = new Map();
  const totals = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
  for (const r of rows) {
    const tokens = (r.promptTokens || 0) + (r.completionTokens || 0);
    const cost = r.cost || 0;
    const day = daily.get(dayKey(new Date(r.timestamp)));
    if (day) { day.requests++; day.tokens += tokens; day.cost += cost; }
    const id = `${r.provider || "unknown"}/${r.model || "unknown"}`;
    const m = byModel.get(id) || { model: r.model || "unknown", provider: r.provider || "unknown", requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    m.requests++; m.promptTokens += r.promptTokens || 0; m.completionTokens += r.completionTokens || 0; m.cost += cost;
    byModel.set(id, m);
    totals.requests++; totals.promptTokens += r.promptTokens || 0; totals.completionTokens += r.completionTokens || 0; totals.cost += cost;
  }
  return { days, totals, daily: [...daily.values()], byModel: [...byModel.values()].sort((a, b) => b.cost - a.cost) };
}
