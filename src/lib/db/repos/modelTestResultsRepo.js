import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// Persisted last-test status per routed model ("alias/modelId" or "providerId/modelId").
// state: "ok" | "error" — error rows feed the combo picker's hide-failed filter.
const SCOPE = "modelTestResults";

export async function getModelTestResults() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  const out = {};
  for (const r of rows) out[r.key] = parseJson(r.value, {});
  return out;
}

// Atomic read-merge-write inside a transaction (no JS yield mid-transaction).
// Stamps testedAt per model so consumers can tell stale results from fresh ones.
export async function saveModelTestResults(results) {
  if (!results || typeof results !== "object") return;
  const entries = Object.entries(results).filter(([key]) => typeof key === "string" && key.includes("/"));
  if (entries.length === 0) return;
  const now = new Date().toISOString();
  const db = await getAdapter();
  db.transaction(() => {
    for (const [key, value] of entries) {
      const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, key]);
      const current = row ? (parseJson(row.value, {}) || {}) : {};
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [SCOPE, key, stringifyJson({ ...current, ...value, testedAt: value.testedAt || now })]
      );
    }
  });
}

export async function clearModelTestResults(models) {
  if (!Array.isArray(models) || models.length === 0) return;
  const db = await getAdapter();
  db.transaction(() => {
    for (const key of models) {
      if (typeof key === "string" && key.includes("/")) {
        db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, key]);
      }
    }
  });
}
