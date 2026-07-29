import { qAll, qGet, qRun } from "../query.js";
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { resolveOrgId, tenantFilters } from "../helpers/orgScope.js";

function rowToPool(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    orgId: row.orgId || null,
    isActive: row.isActive === 1 || row.isActive === true,
    testStatus: row.testStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function poolToRow(p) {
  const { id, orgId, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
  return {
    id,
    orgId: orgId ?? null,
    isActive: isActive === false ? 0 : 1,
    testStatus: testStatus ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

function upsert(db, p) {
  const r = poolToRow(p);
  db.run(
    `INSERT INTO proxyPools(id, orgId, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       orgId=excluded.orgId, isActive=excluded.isActive, testStatus=excluded.testStatus,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.orgId, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt],
  );
}

export async function getProxyPools(filter = {}) {
  const db = await getAdapter();
  const { conds, params } = await tenantFilters({ orgId: filter.orgId });
  if (filter.isActive !== undefined) { conds.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.testStatus) { conds.push("testStatus = ?"); params.push(filter.testStatus); }
  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
  const rows = await qAll(db, `SELECT * FROM proxyPools${where}`, params);
  const list = rows.map(rowToPool);
  list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return list;
}

export async function getProxyPoolById(id, orgId = null) {
  const db = await getAdapter();
  const { conds, params } = await tenantFilters({ orgId });
  conds.push("id = ?");
  params.push(id);
  return rowToPool(await qGet(db, `SELECT * FROM proxyPools WHERE ${conds.join(" AND ")}`, params));
}

export async function createProxyPool(data) {
  const orgId = await resolveOrgId(data.orgId);
  if (!orgId) throw new Error("orgId is required");
  const db = await getAdapter();
  const now = new Date().toISOString();
  const pool = {
    id: data.id || uuidv4(),
    orgId,
    name: data.name,
    proxyUrl: data.proxyUrl,
    noProxy: data.noProxy || "",
    type: data.type || "http",
    isActive: data.isActive !== undefined ? data.isActive : true,
    strictProxy: data.strictProxy === true,
    testStatus: data.testStatus || "unknown",
    lastTestedAt: data.lastTestedAt || null,
    lastError: data.lastError || null,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, pool);
  return pool;
}

export async function updateProxyPool(id, data, orgId = null) {
  const db = await getAdapter();
  const { conds, params } = await tenantFilters({ orgId });
  conds.push("id = ?");
  params.push(id);
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE ${conds.join(" AND ")}`, params);
    if (!row) return;
    const merged = { ...rowToPool(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteProxyPool(id, orgId = null) {
  const db = await getAdapter();
  const { conds, params } = await tenantFilters({ orgId });
  conds.push("id = ?");
  params.push(id);
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE ${conds.join(" AND ")}`, params);
    if (!row) return;
    removed = rowToPool(row);
    db.run(`DELETE FROM proxyPools WHERE id = ?`, [id]);
  });
  return removed;
}
