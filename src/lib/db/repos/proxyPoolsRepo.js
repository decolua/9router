import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToPool(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    isActive: row.isActive === 1 || row.isActive === true,
    testStatus: row.testStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function poolToRow(p) {
  const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
  return {
    id,
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
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       isActive=excluded.isActive, testStatus=excluded.testStatus,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getProxyPools(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.testStatus) { where.push("testStatus = ?"); params.push(filter.testStatus); }
  const sql = `SELECT * FROM proxyPools${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const list = db.all(sql, params).map(rowToPool);
  list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return list;
}

export async function getProxyPoolById(id) {
  const db = await getAdapter();
  return rowToPool(db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]));
}

export async function createProxyPool(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const pool = {
    id: data.id || uuidv4(),
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

export async function updateProxyPool(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToPool(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteProxyPool(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToPool(row);
    db.run(`DELETE FROM proxyPools WHERE id = ?`, [id]);
  });
  return removed;
}

export async function getProxyPoolsBySource(source) {
  const allPools = await getProxyPools();
  return allPools.filter(pool => pool.source === source);
}

export async function upsertProxyPoolBySource({ source, sourceId, fields }) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const allPools = db.all(`SELECT * FROM proxyPools`).map(rowToPool);
    const existing = allPools.find(p => p.source === source && (p.sourceId === sourceId || p.webshareId === sourceId));
    const now = new Date().toISOString();
    
    if (existing) {
      const merged = {
        ...existing,
        ...fields,
        source,
        sourceId,
        webshareId: sourceId,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      };
      upsert(db, merged);
      result = merged;
    } else {
      const pool = {
        // Spread all fields first so Webshare metadata (webshareUsername, webshareCountryCode, etc.) is preserved
        ...fields,
        id: uuidv4(),
        source,
        sourceId,
        webshareId: sourceId,
        name: fields.name || `${source}-${sourceId}`,
        proxyUrl: fields.proxyUrl || "",
        noProxy: fields.noProxy || "",
        type: fields.type || "http",
        isActive: fields.isActive !== undefined ? fields.isActive : true,
        strictProxy: fields.strictProxy === true,
        testStatus: fields.testStatus || "unknown",
        lastTestedAt: fields.lastTestedAt || null,
        lastError: fields.lastError || null,
        createdAt: now,
        updatedAt: now,
      };
      upsert(db, pool);
      result = pool;
    }
  });
  return result;
}
