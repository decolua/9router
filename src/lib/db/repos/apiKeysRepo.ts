import { v4 as uuidv4 } from "uuid";
import type { DbAdapter } from "../driver.js";
import { getAdapter } from "../driver.js";

export interface ApiKey {
  id: string;
  key: string;
  name: string | null;
  machineId: string | null;
  isActive: boolean;
  role: string;
  allowedModels: string[];
  allowedProviders: string[];
  monthlyTokenLimit: number;
  monthlyBudgetUsd: number;
  createdAt: string;
  updatedAt: string | null;
}

function parseJsonArr(s: string | null | undefined): string[] {
  if (!s || typeof s !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(s);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function rowToKey(row: Record<string, unknown> | undefined): ApiKey | null {
  if (!row) return null;
  return {
    id: row["id"] as string,
    key: row["key"] as string,
    name: (row["name"] as string | null) ?? null,
    machineId: (row["machineId"] as string | null) ?? null,
    isActive: row["isActive"] === 1 || row["isActive"] === true,
    role: (row["role"] as string | undefined) ?? "user",
    allowedModels: parseJsonArr(row["allowedModels"] as string | undefined),
    allowedProviders: parseJsonArr(row["allowedProviders"] as string | undefined),
    monthlyTokenLimit: (row["monthlyTokenLimit"] as number | undefined) ?? 0,
    monthlyBudgetUsd: (row["monthlyBudgetUsd"] as number | undefined) ?? 0,
    createdAt: row["createdAt"] as string,
    updatedAt: (row["updatedAt"] as string | null) ?? null,
  };
}

export async function getApiKeys() {
  const db: DbAdapter = await getAdapter();
  return db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`).map(rowToKey).filter((k): k is ApiKey => k !== null);
}

export async function getApiKeyById(id: string) {
  const db: DbAdapter = await getAdapter();
  return rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
}

export async function createApiKey(name: string, machineId: string, opts: Record<string, unknown> = {}) {
  if (!machineId) throw new Error("machineId is required");
  const db: DbAdapter = await getAdapter();
  const countRow = db.get(`SELECT COUNT(*) as c FROM apiKeys`);
  const count = countRow && "c" in countRow && typeof countRow["c"] === "number" ? countRow["c"] : 0;
  const role = count === 0 ? "admin" : opts["role"] === "admin" ? "admin" : "user";
  const allowedModels = Array.isArray(opts["allowedModels"]) ? JSON.stringify(opts["allowedModels"]) : null;
  const allowedProviders = Array.isArray(opts["allowedProviders"]) ? JSON.stringify(opts["allowedProviders"]) : null;
  const monthlyTokenLimit = Number.isFinite(opts["monthlyTokenLimit"]) ? (opts["monthlyTokenLimit"] as number) : 0;
  const monthlyBudgetUsd = Number.isFinite(opts["monthlyBudgetUsd"]) ? (opts["monthlyBudgetUsd"] as number) : 0;
  const createdAt = new Date().toISOString();
  // Dynamic import: apiKey utility uses @/shared alias; kept dynamic to match original.
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey: ApiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    role,
    allowedModels: (opts["allowedModels"] as string[] | undefined) ?? [],
    allowedProviders: (opts["allowedProviders"] as string[] | undefined) ?? [],
    monthlyTokenLimit,
    monthlyBudgetUsd,
    createdAt,
    updatedAt: createdAt,
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, role, allowedModels, allowedProviders, monthlyTokenLimit, monthlyBudgetUsd, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.role, allowedModels, allowedProviders, apiKey.monthlyTokenLimit, apiKey.monthlyBudgetUsd, apiKey.createdAt, apiKey.updatedAt],
  );
  return apiKey;
}

const UPDATABLE_FIELDS = ["name", "isActive", "role", "allowedModels", "allowedProviders", "monthlyTokenLimit", "monthlyBudgetUsd"] as const;

export async function updateApiKey(id: string, data: Record<string, unknown>) {
  const db: DbAdapter = await getAdapter();
  let result: ApiKey | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const cols: string[] = [];
    const params: unknown[] = [];
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
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  return result;
}

export async function deleteApiKey(id: string) {
  const db: DbAdapter = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return ((res as { changes?: number } | undefined)?.changes ?? 0) > 0;
}

export async function resolveApiKeyRecord(rawKey: string | null | undefined) {
  if (!rawKey) return null;
  const db: DbAdapter = await getAdapter();
  return rowToKey(db.get(`SELECT * FROM apiKeys WHERE key = ?`, [rawKey]));
}

export async function validateApiKey(key: string) {
  const r = await resolveApiKeyRecord(key);
  return !!(r && r.isActive);
}
