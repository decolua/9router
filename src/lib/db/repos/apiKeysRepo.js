import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    // Per-key controls. null == no limit.
    rpm: row.rpm ?? null,
    tpm: row.tpm ?? null,
    maxBudget: row.maxBudget ?? null,
    budgetPeriod: row.budgetPeriod || null,
    budgetStartedAt: row.budgetStartedAt || null,
    spend: row.spend ?? 0,
    models: parseModels(row.models),
    priority: row.priority || null,
    expiresAt: row.expiresAt || null,
  };
}

/** Model allowlist is stored as JSON; an empty list means "all models". */
function parseModels(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

const CONTROL_COLUMNS = [
  "rpm", "tpm", "maxBudget", "budgetPeriod", "budgetStartedAt",
  "spend", "models", "priority", "expiresAt",
];

function toColumnValue(name, value) {
  if (name === "models") {
    const list = Array.isArray(value) ? value.filter(Boolean).map(String) : [];
    return list.length ? JSON.stringify(list) : null;
  }
  if (["rpm", "tpm", "maxBudget", "spend"].includes(name)) {
    if (value === "" || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return value === "" || value === undefined ? null : value;
}

/**
 * Budget windows are rolling: "1d", "30d", "1mo"/"1m", "12h".
 * Returns ms, or null for an open-ended budget.
 */
export function budgetPeriodMs(period) {
  if (!period) return null;
  const m = String(period).trim().toLowerCase().match(/^(\d+)\s*(mo|[hdwm])$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const MS = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3, mo: 30 * 86400e3 };
  return n > 0 && MS[unit] ? n * MS[unit] : null;
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
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt]
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
    // Changing the budget or its period restarts the rolling window.
    if (("maxBudget" in data) || ("budgetPeriod" in data)) {
      merged.budgetStartedAt = new Date().toISOString();
      if ("maxBudget" in data) merged.spend = 0;
    }
    const sets = ["key = ?", "name = ?", "machineId = ?", "isActive = ?"];
    const params = [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0];
    for (const col of CONTROL_COLUMNS) {
      sets.push(`${col} = ?`);
      params.push(toColumnValue(col, merged[col]));
    }
    params.push(id);
    db.run(`UPDATE apiKeys SET ${sets.join(", ")} WHERE id = ?`, params);
    result = merged;
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/** Add spend to a key, rolling the budget window over when it has elapsed. */
export async function addKeySpend(key, amount) {
  if (!key || !(amount > 0)) return;
  const db = await getAdapter();
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
    if (!row) return;
    const periodMs = budgetPeriodMs(row.budgetPeriod);
    const startedAt = row.budgetStartedAt ? Date.parse(row.budgetStartedAt) : null;
    const expired = periodMs && startedAt && Date.now() - startedAt >= periodMs;
    const base = expired ? 0 : (row.spend ?? 0);
    db.run(
      `UPDATE apiKeys SET spend = ?, budgetStartedAt = ? WHERE id = ?`,
      [base + amount, expired || !row.budgetStartedAt ? new Date().toISOString() : row.budgetStartedAt, row.id]
    );
  });
}

/** Full key record by its secret, or null. */
export async function getApiKeyBySecret(key) {
  if (!key) return null;
  const db = await getAdapter();
  return rowToKey(db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]));
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
