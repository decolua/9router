import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { nowIso, stampInsert, stampUpdate, stampDelete, NOT_DELETED } from "../../federation/stamp.js";
import { keyAccessFromColumns, keyAccessToColumns } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys WHERE ${NOT_DELETED} ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ? AND ${NOT_DELETED}`, [id]);
  return rowToKey(row);
}

// Used by the /v1 handlers to read the presented key's access settings.
export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    access: { restricted: false, allow: [] },
  };
  const s = stampInsert(db);
  const accessCols = keyAccessToColumns(apiKey.access);
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow${s.cols}) VALUES(?, ?, ?, ?, ?, ?, ?, ?${s.placeholders})`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, accessCols.accessRestricted, accessCols.accessAllow, ...s.params]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    // NOT_DELETED: a tombstoned row must be invisible to writes too, not only to
    // reads. Without it a direct caller (the federation replay path, which does
    // not pre-check getApiKeyById) mutates columns of a row every sibling read
    // hides — pre-fix, with validateApiKey unfiltered, that was a
    // resurrect-by-forge: write a chosen `key` onto a deleted row and it
    // authenticates. The dashboard route is already guarded upstream
    // (src/app/api/keys/[id]/route.js:26 pre-checks getApiKeyById → 404), so this
    // only tightens the shared repository contract.
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ? AND ${NOT_DELETED}`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    const u = stampUpdate(db);
    const cols = keyAccessToColumns(merged.access);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, accessRestricted = ?, accessAllow = ?${u.set} WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, cols.accessRestricted, cols.accessAllow, ...u.params, id]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const d = stampDelete(db);
  const res = db.run(`UPDATE apiKeys SET ${d.set} WHERE id = ?`, [...d.params, id]);
  return (res?.changes ?? 0) > 0;
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  // NOT_DELETED is load-bearing: deleteApiKey() is a tombstone (stampDelete sets
  // deleted = 1 and leaves isActive = 1), so without the predicate a key removed
  // through DELETE /api/keys/[id] keeps authenticating remote /v1 traffic — a
  // revocation that does not revoke. This is the authorization read for the
  // public API surface (src/dashboardGuard.js:166, src/sse/services/auth.js:373).
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ? AND ${NOT_DELETED}`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}
