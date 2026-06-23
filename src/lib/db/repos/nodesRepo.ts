import { v4 as uuidv4 } from "uuid";
import type { DbAdapter } from "../driver.js";
import type { JsonValue } from "open-sse/types/executor.js";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export type ProviderNode = Record<string, unknown> & {
  id: string;
  type: string | null;
  name: string | null;
  createdAt: string;
  updatedAt: string;
};

function rowToNode(row: Record<string, unknown> | undefined): ProviderNode | null {
  if (!row) return null;
  const extra = parseJson(typeof row["data"] === "string" ? row["data"] : null, {}) as Record<string, unknown>;
  return {
    ...extra,
    id: row["id"] as string,
    type: (row["type"] as string | null) ?? null,
    name: (row["name"] as string | null) ?? null,
    createdAt: row["createdAt"] as string,
    updatedAt: row["updatedAt"] as string,
  };
}

function nodeToRow(n: Record<string, unknown>) {
  const { id, type, name, createdAt, updatedAt, ...rest } = n;
  return {
    id, type: type ?? null, name: name ?? null,
    data: stringifyJson(rest as JsonValue),
    createdAt, updatedAt,
  };
}

function upsert(db: DbAdapter, n: Record<string, unknown>) {
  const r = nodeToRow(n);
  db.run(
    `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, name=excluded.name, data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.type, r.name, r.data, r.createdAt, r.updatedAt],
  );
}

export async function getProviderNodes(filter: { type?: string } = {}) {
  const db: DbAdapter = await getAdapter();
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.type) { where.push("type = ?"); params.push(filter.type); }
  const sql = `SELECT * FROM providerNodes${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  return db.all(sql, params).map(rowToNode).filter((n): n is ProviderNode => n !== null);
}

export async function getProviderNodeById(id: string) {
  const db: DbAdapter = await getAdapter();
  return rowToNode(db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]));
}

export async function createProviderNode(data: Record<string, unknown>) {
  const db: DbAdapter = await getAdapter();
  const now = new Date().toISOString();
  const node: Record<string, unknown> = {
    id: (data["id"] as string | undefined) ?? uuidv4(),
    type: data["type"] ?? null,
    name: data["name"] ?? null,
    prefix: data["prefix"],
    apiType: data["apiType"],
    baseUrl: data["baseUrl"],
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, node);
  return rowToNode(db.get(`SELECT * FROM providerNodes WHERE id = ?`, [node["id"]]));
}

export async function updateProviderNode(id: string, data: Record<string, unknown>) {
  const db: DbAdapter = await getAdapter();
  let result: ProviderNode | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToNode(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged as Record<string, unknown>);
    result = rowToNode(db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]));
  });
  return result;
}

export async function deleteProviderNode(id: string) {
  const db: DbAdapter = await getAdapter();
  let removed: ProviderNode | null = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToNode(row);
    db.run(`DELETE FROM providerNodes WHERE id = ?`, [id]);
  });
  return removed;
}
