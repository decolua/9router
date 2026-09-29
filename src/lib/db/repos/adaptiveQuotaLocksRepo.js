import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const PREFIX = "modelLock_";
const GLOBAL = `${PREFIX}__all`;

function lockKey(model) {
  return model ? `${PREFIX}${model}` : GLOBAL;
}

function fromRow(row) {
  if (!row) return null;
  return {
    ...parseJson(row.data, {}), id: row.id, provider: row.provider,
    authType: row.authType, name: row.name, email: row.email,
    priority: row.priority, isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function save(db, connection) {
  const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...data } = connection;
  db.run(
    "UPDATE providerConnections SET provider=?, authType=?, name=?, email=?, priority=?, isActive=?, data=?, updatedAt=? WHERE id=?",
    [provider, authType, name ?? null, email ?? null, priority ?? null, isActive === false ? 0 : 1, stringifyJson(data), updatedAt, id],
  );
}

function metadata(key, lock) {
  return {
    [key]: lock.expiresAt,
    [`${key}Reason`]: lock.reason,
    [`${key}Source`]: lock.source,
    [`${key}ClassifiedAt`]: lock.classifiedAt,
  };
}

export async function extendConnectionModelLock(connectionId, model, lock) {
  const db = await getAdapter();
  const key = lockKey(model);
  let result = null;
  db.transaction(() => {
    const connection = fromRow(db.get("SELECT * FROM providerConnections WHERE id = ?", [connectionId]));
    if (!connection) return;
    const current = Date.parse(connection[key]);
    const requested = Date.parse(lock.expiresAt);
    if (Number.isFinite(current) && current > requested) {
      result = connection;
      return;
    }
    result = { ...connection, ...metadata(key, lock), updatedAt: new Date().toISOString() };
    save(db, result);
  });
  return result;
}

export async function clearConnectionModelLockIfObserved(connectionId, model, observed) {
  const db = await getAdapter();
  const key = lockKey(model);
  let cleared = false;
  db.transaction(() => {
    const connection = fromRow(db.get("SELECT * FROM providerConnections WHERE id = ?", [connectionId]));
    if (!connection || connection[key] !== observed?.expiresAt || connection[`${key}ClassifiedAt`] !== observed?.classifiedAt) return;
    const updated = { ...connection, updatedAt: new Date().toISOString() };
    for (const suffix of ["", "Reason", "Source", "ClassifiedAt"]) delete updated[`${key}${suffix}`];
    save(db, updated);
    cleared = true;
  });
  return cleared;
}

export function getObservedConnectionModelLock(connection, model) {
  const key = lockKey(model);
  if (!connection?.[key]) return null;
  return { expiresAt: connection[key], classifiedAt: connection[`${key}ClassifiedAt`] || null };
}
