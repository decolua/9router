import { qAll, qGet, qRun } from "../query.js";
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { parseEncryptedJson, stringifyEncryptedJson } from "../helpers/encryptedJsonCol.js";
import { isMasterKeyConfigured } from "../../crypto/masterKey.js";

function readData(raw) {
  return isMasterKeyConfigured() ? parseEncryptedJson(raw, {}) : parseJson(raw, {});
}
function writeData(value) {
  return isMasterKeyConfigured() ? stringifyEncryptedJson(value) : stringifyJson(value);
}

const OPTIONAL_FIELDS = [
  "displayName", "email", "globalPriority", "defaultModel",
  "accessToken", "refreshToken", "expiresAt", "tokenType",
  "scope", "projectId", "apiKey", "testStatus",
  "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn", "errorCode",
  "consecutiveUseCount",
];

const UPSERT_SQL = `INSERT INTO providerConnections(id, userId, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
 VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
 ON CONFLICT(id) DO UPDATE SET
   userId=excluded.userId, provider=excluded.provider, authType=excluded.authType, name=excluded.name,
   email=excluded.email, priority=excluded.priority, isActive=excluded.isActive,
   data=excluded.data, updatedAt=excluded.updatedAt`;

function rowToConn(row) {
  if (!row) return null;
  const extra = readData(row.data);
  return {
    ...extra,
    id: row.id,
    provider: row.provider,
    authType: row.authType,
    name: row.name,
    email: row.email,
    priority: row.priority,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function connToRow(c) {
  const { id, userId, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
  return {
    id,
    userId: userId ?? null,
    provider,
    authType,
    name: name ?? null,
    email: email ?? null,
    priority: priority ?? null,
    isActive: isActive === false ? 0 : 1,
    data: writeData(rest),
    createdAt,
    updatedAt,
  };
}

function upsertParams(c) {
  const r = connToRow(c);
  return [r.id, r.userId, r.provider, r.authType, r.name, r.email, r.priority, r.isActive, r.data, r.createdAt, r.updatedAt];
}

function upsertSync(db, c) {
  db.run(UPSERT_SQL, upsertParams(c));
}

async function upsertAsync(db, c) {
  await qRun(db, UPSERT_SQL, upsertParams(c));
}

function reorderInTxSync(db, providerId, userId) {
  const list = db.all(`SELECT * FROM providerConnections WHERE provider = ? AND userId = ?`, [providerId, userId]).map(rowToConn);
  list.sort((a, b) => {
    const pDiff = (a.priority || 0) - (b.priority || 0);
    if (pDiff !== 0) return pDiff;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  list.forEach((c, i) => {
    db.run(`UPDATE providerConnections SET priority = ? WHERE id = ?`, [i + 1, c.id]);
  });
}

async function reorderInTxAsync(db, providerId, userId) {
  const rows = await qAll(db, `SELECT * FROM providerConnections WHERE provider = ? AND userId = ?`, [providerId, userId]);
  const list = rows.map(rowToConn);
  list.sort((a, b) => {
    const pDiff = (a.priority || 0) - (b.priority || 0);
    if (pDiff !== 0) return pDiff;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
  for (let i = 0; i < list.length; i++) {
    await qRun(db, `UPDATE providerConnections SET priority = ? WHERE id = ?`, [i + 1, list[i].id]);
  }
}

function findExistingConnection(all, data) {
  if (data.authType === "oauth" && data.email) {
    const incomingWs = data.providerSpecificData?.chatgptAccountId;
    return all.find((c) => {
      if (c.authType !== "oauth" || c.email !== data.email) return false;
      const existingWs = c.providerSpecificData?.chatgptAccountId;
      if (incomingWs && existingWs) return incomingWs === existingWs;
      return true;
    }) || null;
  }
  if (data.authType === "apikey" && data.name) {
    return all.find((c) => c.authType === "apikey" && c.name === data.name) || null;
  }
  return null;
}

function buildNewConnection(data, all, now) {
  let connectionName = data.name || null;
  if (!connectionName && (data.authType === "oauth" || data.authType === "access_token")) {
    connectionName = data.email || `Account ${all.length + 1}`;
  }
  let connectionPriority = data.priority;
  if (!connectionPriority) {
    connectionPriority = all.reduce((m, c) => Math.max(m, c.priority || 0), 0) + 1;
  }
  const conn = {
    id: uuidv4(),
    userId: data.userId,
    provider: data.provider,
    authType: data.authType || "oauth",
    name: connectionName,
    priority: connectionPriority,
    isActive: data.isActive !== undefined ? data.isActive : true,
    createdAt: now,
    updatedAt: now,
  };
  for (const f of OPTIONAL_FIELDS) {
    if (data[f] !== undefined && data[f] !== null) conn[f] = data[f];
  }
  if (data.providerSpecificData && Object.keys(data.providerSpecificData).length > 0) {
    conn.providerSpecificData = data.providerSpecificData;
  }
  if (data.email !== undefined) conn.email = data.email;
  return conn;
}

import { getRuntimeUserId } from "../../auth/runtimeUserContext.js";

async function scopedUserId(userId) {
  return userId || getRuntimeUserId() || null;
}

export async function getProviderConnections(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  const userId = await scopedUserId(filter.userId);
  if (userId) { where.push("userId = ?"); params.push(userId); }
  if (filter.provider) { where.push("provider = ?"); params.push(filter.provider); }
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  const sql = `SELECT * FROM providerConnections${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const rows = await qAll(db, sql, params);
  const list = rows.map(rowToConn);
  list.sort((a, b) => (a.priority || 999) - (b.priority || 999));
  return list;
}

export async function getProviderConnectionById(id, userId = null) {
  const db = await getAdapter();
  const row = userId
    ? await qGet(db, `SELECT * FROM providerConnections WHERE id = ? AND userId = ?`, [id, userId])
    : await qGet(db, `SELECT * FROM providerConnections WHERE id = ?`, [id]);
  return rowToConn(row);
}

export async function createProviderConnection(data) {
  const userId = data.userId || getRuntimeUserId();
  if (!userId) throw new Error("userId is required");
  data = { ...data, userId };
  const db = await getAdapter();
  const now = new Date().toISOString();

  if (db.dialect === "postgres") {
    let result;
    await db.transaction(async (tx) => {
      const rows = await tx.all(`SELECT * FROM providerConnections WHERE provider = ? AND userId = ?`, [data.provider, data.userId]);
      const all = rows.map(rowToConn);
      const existing = findExistingConnection(all, data);
      if (existing) {
        const merged = { ...existing, ...data, updatedAt: now };
        await upsertAsync(tx, merged);
        result = merged;
        return;
      }
      const conn = buildNewConnection(data, all, now);
      await upsertAsync(tx, conn);
      await reorderInTxAsync(tx, data.provider, data.userId);
      result = conn;
    });
    return result;
  }

  let result;
  db.transaction(() => {
    const all = db.all(`SELECT * FROM providerConnections WHERE provider = ? AND userId = ?`, [data.provider, data.userId]).map(rowToConn);
    const existing = findExistingConnection(all, data);
    if (existing) {
      const merged = { ...existing, ...data, updatedAt: now };
      upsertSync(db, merged);
      result = merged;
      return;
    }
    const conn = buildNewConnection(data, all, now);
    upsertSync(db, conn);
    reorderInTxSync(db, data.provider, data.userId);
    result = conn;
  });
  return result;
}

export async function updateProviderConnection(id, data, userId = null) {
  const db = await getAdapter();

  if (db.dialect === "postgres") {
    let result;
    await db.transaction(async (tx) => {
      const row = userId
        ? await tx.get(`SELECT * FROM providerConnections WHERE id = ? AND userId = ?`, [id, userId])
        : await tx.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
      if (!row) { result = null; return; }
      const existing = rowToConn(row);
      const merged = { ...existing, ...data, updatedAt: new Date().toISOString() };
      await upsertAsync(tx, merged);
      if (data.priority !== undefined) await reorderInTxAsync(tx, existing.provider, existing.userId || userId);
      result = merged;
    });
    return result;
  }

  let result;
  db.transaction(() => {
    const row = userId
      ? db.get(`SELECT * FROM providerConnections WHERE id = ? AND userId = ?`, [id, userId])
      : db.get(`SELECT * FROM providerConnections WHERE id = ?`, [id]);
    if (!row) { result = null; return; }
    const existing = rowToConn(row);
    const merged = { ...existing, ...data, updatedAt: new Date().toISOString() };
    upsertSync(db, merged);
    if (data.priority !== undefined) reorderInTxSync(db, existing.provider, existing.userId || userId);
    result = merged;
  });
  return result;
}

export async function deleteProviderConnection(id, userId = null) {
  const db = await getAdapter();

  if (db.dialect === "postgres") {
    let ok = false;
    await db.transaction(async (tx) => {
      const row = userId
        ? await tx.get(`SELECT provider, userId FROM providerConnections WHERE id = ? AND userId = ?`, [id, userId])
        : await tx.get(`SELECT provider, userId FROM providerConnections WHERE id = ?`, [id]);
      if (!row) return;
      await tx.run(`DELETE FROM providerConnections WHERE id = ?`, [id]);
      await reorderInTxAsync(tx, row.provider, row.userId);
      ok = true;
    });
    return ok;
  }

  let ok = false;
  db.transaction(() => {
    const row = userId
      ? db.get(`SELECT provider, userId FROM providerConnections WHERE id = ? AND userId = ?`, [id, userId])
      : db.get(`SELECT provider, userId FROM providerConnections WHERE id = ?`, [id]);
    if (!row) return;
    db.run(`DELETE FROM providerConnections WHERE id = ?`, [id]);
    reorderInTxSync(db, row.provider, row.userId);
    ok = true;
  });
  return ok;
}

export async function deleteProviderConnectionsByProvider(providerId, userId = null) {
  const db = await getAdapter();
  if (userId) {
    const before = await qGet(db, `SELECT COUNT(*) AS n FROM providerConnections WHERE provider = ? AND userId = ?`, [providerId, userId]);
    await qRun(db, `DELETE FROM providerConnections WHERE provider = ? AND userId = ?`, [providerId, userId]);
    return before?.n || 0;
  }
  const before = await qGet(db, `SELECT COUNT(*) AS n FROM providerConnections WHERE provider = ?`, [providerId]);
  await qRun(db, `DELETE FROM providerConnections WHERE provider = ?`, [providerId]);
  return before?.n || 0;
}

export async function reorderProviderConnections(providerId, userId) {
  const db = await getAdapter();
  if (db.dialect === "postgres") {
    await db.transaction(async (tx) => reorderInTxAsync(tx, providerId, userId));
  } else {
    db.transaction(() => reorderInTxSync(db, providerId, userId));
  }
}

export async function cleanupProviderConnections() {
  const db = await getAdapter();
  const fieldsToCheck = [
    "displayName", "email", "globalPriority", "defaultModel",
    "accessToken", "refreshToken", "expiresAt", "tokenType",
    "scope", "projectId", "apiKey", "testStatus",
    "lastTested", "lastError", "lastErrorAt", "rateLimitedUntil", "expiresIn",
    "consecutiveUseCount",
  ];

  const cleanupRows = async (tx, rows) => {
    let cleaned = 0;
    for (const row of rows) {
      const conn = rowToConn(row);
      let dirty = false;
      for (const f of fieldsToCheck) {
        if (conn[f] === null || conn[f] === undefined) {
          if (f in conn) { delete conn[f]; cleaned++; dirty = true; }
        }
      }
      if (conn.providerSpecificData && Object.keys(conn.providerSpecificData).length === 0) {
        delete conn.providerSpecificData;
        cleaned++;
        dirty = true;
      }
      if (dirty) await upsertAsync(tx, conn);
    }
    return cleaned;
  };

  const cleanupRowsSync = (tx, rows) => {
    let cleaned = 0;
    for (const row of rows) {
      const conn = rowToConn(row);
      let dirty = false;
      for (const f of fieldsToCheck) {
        if (conn[f] === null || conn[f] === undefined) {
          if (f in conn) { delete conn[f]; cleaned++; dirty = true; }
        }
      }
      if (conn.providerSpecificData && Object.keys(conn.providerSpecificData).length === 0) {
        delete conn.providerSpecificData;
        cleaned++;
        dirty = true;
      }
      if (dirty) upsertSync(tx, conn);
    }
    return cleaned;
  };

  if (db.dialect === "postgres") {
    let cleaned = 0;
    await db.transaction(async (tx) => {
      const rows = await tx.all(`SELECT * FROM providerConnections`);
      cleaned = await cleanupRows(tx, rows);
    });
    return cleaned;
  }

  let cleaned = 0;
  db.transaction(() => {
    const rows = db.all(`SELECT * FROM providerConnections`);
    cleaned = cleanupRowsSync(db, rows);
  });
  return cleaned;
}
