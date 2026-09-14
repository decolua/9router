import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { nowIso, stampInsert, stampUpsertConflict, stampDelete, NOT_DELETED } from "../../federation/stamp.js";

const SCOPE = "disabledModels";

export async function getDisabledModels() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ? AND ${NOT_DELETED}`, [SCOPE]);
  const out = {};
  for (const r of rows) out[r.key] = parseJson(r.value, []);
  return out;
}

export async function getDisabledByProvider(providerAlias) {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ? AND ${NOT_DELETED}`, [SCOPE, providerAlias]);
  return row ? (parseJson(row.value, []) || []) : [];
}

// Atomic read-merge-write inside a transaction (no JS yield mid-transaction).
export async function disableModels(providerAlias, ids) {
  if (!providerAlias || !Array.isArray(ids)) return;
  const db = await getAdapter();
  db.transaction(() => {
    const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
    const current = row ? (parseJson(row.value, []) || []) : [];
    const merged = [...new Set([...current, ...ids])];
    const s = stampInsert(db);
    db.run(
      `INSERT INTO kv(scope, key, value${s.cols}) VALUES(?, ?, ?${s.placeholders}) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value${stampUpsertConflict()}`,
      [SCOPE, providerAlias, stringifyJson(merged), ...s.params]
    );
  });
}

export async function enableModels(providerAlias, ids) {
  if (!providerAlias) return;
  const db = await getAdapter();
  db.transaction(() => {
    if (!Array.isArray(ids) || ids.length === 0) {
      const d = stampDelete(db);
      db.run(`UPDATE kv SET ${d.set} WHERE scope = ? AND key = ?`, [...d.params, SCOPE, providerAlias]);
      return;
    }
    const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
    const current = row ? (parseJson(row.value, []) || []) : [];
    const removeSet = new Set(ids);
    const next = current.filter((id) => !removeSet.has(id));
    if (next.length === 0) {
      const d = stampDelete(db);
      db.run(`UPDATE kv SET ${d.set} WHERE scope = ? AND key = ?`, [...d.params, SCOPE, providerAlias]);
    } else {
      const s = stampInsert(db);
      db.run(
        `INSERT INTO kv(scope, key, value${s.cols}) VALUES(?, ?, ?${s.placeholders}) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value${stampUpsertConflict()}`,
        [SCOPE, providerAlias, stringifyJson(next), ...s.params]
      );
    }
  });
}
