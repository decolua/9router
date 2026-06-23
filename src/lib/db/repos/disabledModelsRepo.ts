import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const SCOPE = "disabledModels";

export async function getDisabledModels() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]) as Record<string, unknown>[];
  const out: Record<string, string[]> = {};
  for (const r of rows) out[r["key"] as string] = parseJson(r["value"] as string | null, []) as string[];
  return out;
}

export async function getDisabledByProvider(providerAlias: string) {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]) as Record<string, unknown> | undefined;
  return row ? ((parseJson(row["value"] as string | null, []) as string[]) ?? []) : [];
}

// Atomic read-merge-write inside a transaction (no JS yield mid-transaction).
export async function disableModels(providerAlias: string, ids: string[]) {
  if (!providerAlias || !Array.isArray(ids)) return;
  const db = await getAdapter();
  db.transaction(() => {
    const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]) as Record<string, unknown> | undefined;
    const current = row ? ((parseJson(row["value"] as string | null, []) as string[]) ?? []) : [];
    const merged = [...new Set([...current, ...ids])];
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [SCOPE, providerAlias, stringifyJson(merged)]
    );
  });
}

export async function enableModels(providerAlias: string, ids: string[]) {
  if (!providerAlias) return;
  const db = await getAdapter();
  db.transaction(() => {
    if (!Array.isArray(ids) || ids.length === 0) {
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
      return;
    }
    const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]) as Record<string, unknown> | undefined;
    const current = row ? ((parseJson(row["value"] as string | null, []) as string[]) ?? []) : [];
    const removeSet = new Set(ids);
    const next = current.filter((id) => !removeSet.has(id));
    if (next.length === 0) {
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
    } else {
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [SCOPE, providerAlias, stringifyJson(next)]
      );
    }
  });
}
