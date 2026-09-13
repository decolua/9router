// 009: remove persisted data for retired providers and standalone media services.
// Qoder (registry id "qoder", model-string alias "qd") and the direct NVIDIA
// NIM provider (id: "nvidia") are removed from the registry, and the
// standalone media services (embedding, image, tts, stt, webSearch, webFetch,
// video, music) are removed while LLM chat routing stays.
//
// Cleans existing rows: providerConnections, media providerNodes
// (custom-embedding), media combos, LLM-combo members that route to a retired
// provider, modelAliases (either persisted direction) pointing at retired
// providers, customModels (retired providers or media types), disabledModels
// and pricing entries for retired providers, and settings per-provider
// references that are reliably identifiable (providerStrategies,
// quotaVisibility). Usage history is never touched.
//
// NVIDIA scope guard: only the direct provider id matches. Third-party
// catalogs that surface nvidia model ids under their own alias (e.g.
// "kgw/nvidia/nemotron-…" via kilo-gateway) are preserved — matching is
// first-URL-segment only, never a mid-string "nvidia/" hit.
//
// The same rules live in helpers/retiredData.js and are reused by importDb()
// and the legacy JSON import so old exports / db.json files cannot
// reintroduce retired rows after this migration has run.
//
// Pure DELETE/UPDATE on existing tables — no DDL — so it stays inside the
// transactional wrapper (unlike 003 which needs VACUUM).
import {
  REMOVED_PROVIDERS,
  isRemovedModelString,
  sanitizeProviderNodes,
  sanitizeCombos,
  sanitizeModelAliases,
  sanitizeCustomModels,
  sanitizeSettings,
} from "../helpers/retiredData.js";

const migration = {
  version: 9,
  name: "cleanup-retired-provider-media-data",
  transactional: true,
  up(db) {
    // 1. Retired provider connections (registry id and model alias).
    for (const provider of REMOVED_PROVIDERS) {
      db.run(`DELETE FROM providerConnections WHERE provider = ?`, [provider]);
    }

    // 2. Media provider nodes (custom embedding endpoints).
    db.run(`DELETE FROM providerNodes WHERE type = 'custom-embedding'`);

    // 3. Combos: drop media kinds, strip retired-provider members from LLM
    // combos, delete combos left with no members.
    const combos = db.all(`SELECT id, kind, models FROM combos`).map((r) => ({
      id: r.id,
      kind: r.kind,
      models: parseJsonSafe(r.models, []),
    }));
    const keptIds = new Set();
    for (const clean of sanitizeCombos(combos)) {
      keptIds.add(clean.id);
      const original = combos.find((c) => c.id === clean.id);
      if (!original) continue;
      if (Array.isArray(clean.models) && Array.isArray(original.models) && clean.models.length !== original.models.length) {
        db.run(`UPDATE combos SET models = ? WHERE id = ?`, [JSON.stringify(clean.models), clean.id]);
      }
    }
    for (const c of combos) {
      if (!keptIds.has(c.id)) {
        db.run(`DELETE FROM combos WHERE id = ?`, [c.id]);
      }
    }

    // 4. Aliases: drop entries whose key OR value targets a retired provider
    // (both writer routes persist a different direction).
    const aliases = {};
    for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) {
      aliases[r.key] = parseJsonSafe(r.value, r.value);
    }
    const cleanAliases = sanitizeModelAliases(aliases);
    for (const key of Object.keys(aliases)) {
      if (!(key in cleanAliases)) {
        db.run(`DELETE FROM kv WHERE scope = 'modelAliases' AND key = ?`, [key]);
      }
    }

    // 5. Custom models: retired providers or media types.
    const removedCustomKeys = new Set();
    for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) {
      const parsed = parseJsonSafe(r.value, null);
      const model = parsed || customModelFromKey(r.key);
      if (sanitizeCustomModels([model]).length === 0) removedCustomKeys.add(r.key);
    }
    for (const key of removedCustomKeys) {
      db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key = ?`, [key]);
    }

    // 6. Disabled models + pricing for retired providers.
    for (const provider of REMOVED_PROVIDERS) {
      db.run(`DELETE FROM kv WHERE scope = 'disabledModels' AND key = ?`, [provider]);
      db.run(`DELETE FROM kv WHERE scope = 'pricing' AND key = ?`, [provider]);
    }

    // 7. Settings: strip reliably-identifiable retired-provider references.
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (row && row.data) {
      const parsed = parseJsonSafe(row.data, null);
      if (parsed && typeof parsed === "object") {
        const clean = sanitizeSettings(parsed);
        if (clean !== parsed) {
          db.run(`UPDATE settings SET data = ? WHERE id = 1`, [JSON.stringify(clean)]);
        }
      }
    }
  },
};

function parseJsonSafe(str, fallback) {
  if (typeof str !== "string") return str ?? fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

// Fallback when a customModels row isn't valid JSON: parse the KV key
// ("providerAlias|id|type").
function customModelFromKey(key) {
  const parts = String(key).split("|");
  return {
    providerAlias: parts[0] ?? null,
    id: parts[1] ?? null,
    type: parts[2] ?? "llm",
  };
}

export default migration;
