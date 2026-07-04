import { qAll, qGet, qRun } from "../query.js";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "./jsonCol.js";

export function makeKv(scope, userId = null, orgId = null) {
  let effectiveScope = scope;
  if (userId) {
    effectiveScope = orgId ? `${scope}:org:${orgId}:user:${userId}` : `${scope}:user:${userId}`;
  }
  return {
    scope: effectiveScope,
    async get(key, fallback = null) {
      const db = await getAdapter();
      const row = await qGet(db, `SELECT value FROM kv WHERE scope = ? AND key = ?`, [effectiveScope, key]);
      return row ? parseJson(row.value, fallback) : fallback;
    },
    async getAll() {
      const db = await getAdapter();
      const rows = await qAll(db, `SELECT key, value FROM kv WHERE scope = ?`, [effectiveScope]);
      const out = {};
      for (const r of rows) out[r.key] = parseJson(r.value);
      return out;
    },
    async set(key, value) {
      const db = await getAdapter();
      await qRun(
        db,
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [effectiveScope, key, stringifyJson(value)]
      );
    },
    async setMany(obj) {
      const db = await getAdapter();
      db.transaction(() => {
        for (const [k, v] of Object.entries(obj)) {
          db.run(
            `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
            [effectiveScope, k, stringifyJson(v)]
          );
        }
      });
    },
    async remove(key) {
      const db = await getAdapter();
      await qRun(db, `DELETE FROM kv WHERE scope = ? AND key = ?`, [effectiveScope, key]);
    },
    async clear() {
      const db = await getAdapter();
      await qRun(db, `DELETE FROM kv WHERE scope = ?`, [effectiveScope]);
    },
  };
}
