import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// Hourly-synced free-model catalogs discovered from free-tier providers'
// public models endpoints (see shared/services/freeModelSync.js).
// key = provider id (e.g. "opencode"), value = { ids: [], updatedAt }
const SCOPE = "freeModels";

function rowToEntry(row) {
  if (!row) return null;
  const parsed = parseJson(row.value, null);
  if (!parsed || !Array.isArray(parsed.ids)) return null;
  return { ids: parsed.ids.filter((id) => typeof id === "string" && id.trim()), updatedAt: parsed.updatedAt || null };
}

export async function getFreeModels() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  const out = {};
  for (const r of rows) {
    const entry = rowToEntry(r);
    if (entry) out[r.key] = entry;
  }
  return out;
}

export async function getFreeModelsForProvider(providerId) {
  if (!providerId) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerId]);
  return rowToEntry(row);
}

export async function setFreeModels(providerId, ids) {
  if (!providerId || !Array.isArray(ids)) return;
  const clean = [...new Set(ids.filter((id) => typeof id === "string" && id.trim()))];
  const db = await getAdapter();
  db.transaction(() => {
    if (clean.length === 0) {
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerId]);
      return;
    }
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [SCOPE, providerId, stringifyJson({ ids: clean, updatedAt: new Date().toISOString() })]
    );
  });
}
