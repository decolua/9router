import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// Visible-model allowlist, keyed by provider alias (e.g. "gh" for GitHub
// Copilot). Semantics are the inverse of `disabledModels`: a missing key means
// "no allowlist" (everything the provider exposes stays visible), while a
// present key lists the ONLY model ids /v1/models may expose for that provider.
//
// Providers with a live catalog (github/kiro/qoder/...) need this: the static
// registry the dashboard renders is a subset of what the account can actually
// use, so a blacklist built from it can never hide catalog-only ids.
const SCOPE = "enabledModels";

export async function getEnabledModels() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  const out = {};
  for (const r of rows) out[r.key] = parseJson(r.value, []);
  return out;
}

export async function getEnabledByProvider(providerAlias) {
  const db = await getAdapter();
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
  return row ? (parseJson(row.value, []) || []) : [];
}

// Sets (or clears, when ids is empty) the allowlist for one provider alias.
// Blank/duplicate ids are dropped so the stored list matches what /v1/models
// compares against.
export async function setEnabledModels(providerAlias, ids) {
  if (!providerAlias) return;
  const db = await getAdapter();
  const list = Array.isArray(ids)
    ? [...new Set(ids.filter((id) => typeof id === "string" && id.trim() !== "").map((id) => id.trim()))]
    : [];

  db.transaction(() => {
    if (list.length === 0) {
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
      return;
    }
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [SCOPE, providerAlias, stringifyJson(list)]
    );
  });
}
