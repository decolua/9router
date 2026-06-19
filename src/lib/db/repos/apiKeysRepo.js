import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function parseJsonArr(s) {
  if (!s || typeof s !== "string") return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    role: row.role || "user",
    allowedModels: parseJsonArr(row.allowedModels),
    allowedProviders: parseJsonArr(row.allowedProviders),
    monthlyTokenLimit: row.monthlyTokenLimit || 0,
    monthlyBudgetUsd: row.monthlyBudgetUsd || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || null,
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

export async function createApiKey(name, machineId, opts = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  // Bootstrap: first ever key is forced admin so the system is bootstrappable.
  const count = db.get(`SELECT COUNT(*) as c FROM apiKeys`).c;
  const role = count === 0 ? "admin" : opts.role === "admin" ? "admin" : "user";
  const allowedModels = Array.isArray(opts.allowedModels) ? JSON.stringify(opts.allowedModels) : null;
  const allowedProviders = Array.isArray(opts.allowedProviders) ? JSON.stringify(opts.allowedProviders) : null;
  const monthlyTokenLimit = Number.isFinite(opts.monthlyTokenLimit) ? opts.monthlyTokenLimit : 0;
  const monthlyBudgetUsd = Number.isFinite(opts.monthlyBudgetUsd) ? opts.monthlyBudgetUsd : 0;
  const createdAt = new Date().toISOString();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    role,
    allowedModels: opts.allowedModels || [],
    allowedProviders: opts.allowedProviders || [],
    monthlyTokenLimit,
    monthlyBudgetUsd,
    createdAt,
    updatedAt: createdAt,
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, role, allowedModels, allowedProviders, monthlyTokenLimit, monthlyBudgetUsd, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      apiKey.id,
      apiKey.key,
      apiKey.name,
      apiKey.machineId,
      1,
      apiKey.role,
      allowedModels,
      allowedProviders,
      apiKey.monthlyTokenLimit,
      apiKey.monthlyBudgetUsd,
      apiKey.createdAt,
      apiKey.updatedAt,
    ]
  );
  return apiKey;
}

const UPDATABLE_FIELDS = [
  "name",
  "isActive",
  "role",
  "allowedModels",
  "allowedProviders",
  "monthlyTokenLimit",
  "monthlyBudgetUsd",
];

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const cols = [];
    const params = [];
    for (const f of UPDATABLE_FIELDS) {
      if (!(f in data)) continue;
      if (f === "allowedModels" || f === "allowedProviders") {
        const v = data[f];
        cols.push(`${f} = ?`);
        params.push(Array.isArray(v) ? JSON.stringify(v) : v == null ? null : JSON.stringify(v));
      } else if (f === "isActive") {
        cols.push(`${f} = ?`);
        params.push(data[f] ? 1 : 0);
      } else {
        cols.push(`${f} = ?`);
        params.push(data[f]);
      }
    }
    cols.push(`updatedAt = ?`);
    params.push(new Date().toISOString());
    params.push(id);
    db.run(`UPDATE apiKeys SET ${cols.join(", ")} WHERE id = ?`, params);
    const fresh = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    result = rowToKey(fresh);
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function resolveApiKeyRecord(rawKey) {
  if (!rawKey) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [rawKey]);
  return rowToKey(row);
}

export async function validateApiKey(key) {
  const r = await resolveApiKeyRecord(key);
  return !!(r && r.isActive);
}
