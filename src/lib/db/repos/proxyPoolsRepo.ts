import { v4 as uuidv4 } from "uuid";
import type { DbAdapter } from "../driver.js";
import type { JsonValue } from "open-sse/types/executor.js";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export type ProxyPool = Record<string, unknown> & {
  id: string;
  isActive: boolean;
  testStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

function rowToPool(row: Record<string, unknown> | undefined): ProxyPool | null {
  if (!row) return null;
  const extra = parseJson(typeof row["data"] === "string" ? row["data"] : null, {}) as Record<string, unknown>;
  return {
    ...extra,
    id: row["id"] as string,
    isActive: row["isActive"] === 1 || row["isActive"] === true,
    testStatus: (row["testStatus"] as string | null) ?? null,
    createdAt: row["createdAt"] as string,
    updatedAt: row["updatedAt"] as string,
  };
}

function poolToRow(p: Record<string, unknown>) {
  const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
  return {
    id,
    isActive: isActive === false ? 0 : 1,
    testStatus: testStatus ?? null,
    data: stringifyJson(rest as JsonValue),
    createdAt,
    updatedAt,
  };
}

function upsert(db: DbAdapter, p: Record<string, unknown>) {
  const r = poolToRow(p);
  db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       isActive=excluded.isActive, testStatus=excluded.testStatus,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt],
  );
}

export async function getProxyPools(filter: { isActive?: boolean; testStatus?: string } = {}) {
  const db: DbAdapter = await getAdapter();
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.testStatus) { where.push("testStatus = ?"); params.push(filter.testStatus); }
  const sql = `SELECT * FROM proxyPools${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const list = db.all(sql, params).map(rowToPool).filter((p): p is ProxyPool => p !== null);
  list.sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime());
  return list;
}

export async function getProxyPoolById(id: string) {
  const db: DbAdapter = await getAdapter();
  return rowToPool(db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]));
}

export async function createProxyPool(data: Record<string, unknown>) {
  const db: DbAdapter = await getAdapter();
  const now = new Date().toISOString();
  const pool: Record<string, unknown> = {
    id: (data["id"] as string | undefined) ?? uuidv4(),
    name: data["name"],
    proxyUrl: data["proxyUrl"],
    noProxy: data["noProxy"] ?? "",
    type: data["type"] ?? "http",
    isActive: data["isActive"] !== undefined ? data["isActive"] : true,
    strictProxy: data["strictProxy"] === true,
    testStatus: data["testStatus"] ?? "unknown",
    lastTestedAt: data["lastTestedAt"] ?? null,
    lastError: data["lastError"] ?? null,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, pool);
  return rowToPool(db.get(`SELECT * FROM proxyPools WHERE id = ?`, [pool["id"]]));
}

export async function updateProxyPool(id: string, data: Record<string, unknown>) {
  const db: DbAdapter = await getAdapter();
  let result: ProxyPool | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToPool(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged as Record<string, unknown>);
    result = rowToPool(db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]));
  });
  return result;
}

export async function deleteProxyPool(id: string) {
  const db: DbAdapter = await getAdapter();
  let removed: ProxyPool | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToPool(row);
    db.run(`DELETE FROM proxyPools WHERE id = ?`, [id]);
  });
  return removed;
}
