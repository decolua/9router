import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "./jsonCol.js";
import { nowIso, stampInsert, stampUpsertConflict, stampDelete } from "../../federation/stamp.js";

export function makeKv(scope) {
  return {
    async get(key, fallback = null) {
      const db = await getAdapter();
      const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ? AND (deleted = 0 OR deleted IS NULL)`, [scope, key]);
      return row ? parseJson(row.value, fallback) : fallback;
    },
    async getAll() {
      const db = await getAdapter();
      const rows = db.all(`SELECT key, value FROM kv WHERE scope = ? AND (deleted = 0 OR deleted IS NULL)`, [scope]);
      const out = {};
      for (const r of rows) out[r.key] = parseJson(r.value);
      return out;
    },
    async set(key, value) {
      const db = await getAdapter();
      const s = stampInsert(db);
      db.run(`INSERT INTO kv(scope, key, value${s.cols}) VALUES(?, ?, ?${s.placeholders}) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value${stampUpsertConflict()}`, [scope, key, stringifyJson(value), ...s.params]);
    },
    async setMany(obj) {
      const db = await getAdapter();
      db.transaction(() => {
        for (const [k, v] of Object.entries(obj)) {
          const s = stampInsert(db);
          db.run(`INSERT INTO kv(scope, key, value${s.cols}) VALUES(?, ?, ?${s.placeholders}) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value${stampUpsertConflict()}`, [scope, k, stringifyJson(v), ...s.params]);
        }
      });
    },
    async remove(key) {
      const db = await getAdapter();
      const d = stampDelete(db);
      db.run(`UPDATE kv SET ${d.set} WHERE scope = ? AND key = ?`, [...d.params, scope, key]);
    },
    async clear() {
      const db = await getAdapter();
      const d = stampDelete(db);
      db.run(`UPDATE kv SET ${d.set} WHERE scope = ?`, [...d.params, scope]);
    },
  };
}
