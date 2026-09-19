import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { deleteProviderConnectionsByProviderInTx } from "./connectionsRepo.js";

function rowToNode(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    type: row.type,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function nodeToRow(n) {
  const { id, type, name, createdAt, updatedAt, ...rest } = n;
  return {
    id,
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
    `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, name=excluded.name, data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.type, r.name, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getProviderNodes(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.type) { where.push("type = ?"); params.push(filter.type); }
  const sql = `SELECT * FROM providerNodes${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  return db.all(sql, params).map(rowToNode);
}

export async function getProviderNodeById(id) {
  const db = await getAdapter();
  return rowToNode(db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]));
}

export async function createProviderNode(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const node = {
    id: data.id || uuidv4(),
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

export async function updateProviderNode(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToNode(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

function deleteProviderNodeInTx(db, id) {
  const row = db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
  if (!row) return null;
  const removed = rowToNode(row);
  db.run(`DELETE FROM providerNodes WHERE id = ?`, [id]);
  return removed;
}

export async function deleteProviderNode(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    removed = deleteProviderNodeInTx(db, id);
  });
  return removed;
}

// T1.5 §B5: DELETE /api/provider-nodes/[id] used to run the connections wipe
// and the node delete as two independent writes — failing between them left a
// node without its connections (or vice-versa). This runs both in ONE
// transaction via the repos' sync cores (see the comment on
// deleteProviderConnectionsByProviderInTx for why async repo functions cannot
// be nested in a transaction callback).
export async function deleteProviderNodeWithConnections(id) {
  const db = await getAdapter();
  let removedNode = null;
  let removedConnections = 0;
  db.transaction(() => {
    removedConnections = deleteProviderConnectionsByProviderInTx(db, id);
    removedNode = deleteProviderNodeInTx(db, id);
  });
  return { removedNode, removedConnections };
}
