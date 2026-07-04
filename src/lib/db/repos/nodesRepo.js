import { qAll, qGet, qRun, qExec } from "../query.js";
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { resolveOrgId, tenantFilters } from "../helpers/orgScope.js";

function rowToNode(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    orgId: row.orgId || null,
    type: row.type,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function nodeToRow(n) {
  const { id, orgId, type, name, createdAt, updatedAt, ...rest } = n;
  return {
    id,
    orgId: orgId ?? null,
    type: type ?? null,
    name: name ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, n) {
  const r = nodeToRow(n);
  db.run(
    `INSERT INTO providerNodes(id, orgId, type, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       orgId=excluded.orgId, type=excluded.type, name=excluded.name, data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.orgId, r.type, r.name, r.data, r.createdAt, r.updatedAt],
  );
}

export async function getProviderNodes(filter = {}) {
  const db = await getAdapter();
  const { conds, params } = await tenantFilters({ orgId: filter.orgId });
  if (filter.type) { conds.push("type = ?"); params.push(filter.type); }
  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
  const rows = await qAll(db, `SELECT * FROM providerNodes${where}`, params);
  return rows.map(rowToNode);
}

export async function getProviderNodeById(id, orgId = null) {
  const db = await getAdapter();
  const { conds, params } = await tenantFilters({ orgId });
  conds.push("id = ?");
  params.push(id);
  return rowToNode(await qGet(db, `SELECT * FROM providerNodes WHERE ${conds.join(" AND ")}`, params));
}

export async function createProviderNode(data) {
  const orgId = await resolveOrgId(data.orgId);
  if (!orgId) throw new Error("orgId is required");
  const db = await getAdapter();
  const now = new Date().toISOString();
  const node = {
    id: data.id || uuidv4(),
    orgId,
    type: data.type,
    name: data.name,
    prefix: data.prefix,
    apiType: data.apiType,
    baseUrl: data.baseUrl,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, node);
  return node;
}

export async function updateProviderNode(id, data, orgId = null) {
  const db = await getAdapter();
  const { conds, params } = await tenantFilters({ orgId });
  conds.push("id = ?");
  params.push(id);
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE ${conds.join(" AND ")}`, params);
    if (!row) return;
    const merged = { ...rowToNode(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteProviderNode(id, orgId = null) {
  const db = await getAdapter();
  const { conds, params } = await tenantFilters({ orgId });
  conds.push("id = ?");
  params.push(id);
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE ${conds.join(" AND ")}`, params);
    if (!row) return;
    removed = rowToNode(row);
    db.run(`DELETE FROM providerNodes WHERE id = ?`, [id]);
  });
  return removed;
}
