// Shared sanitizer for retired provider + standalone media records.
// Used by:
//  - migrations/009-cleanup-retired-provider-media-data.js (existing SQLite rows)
//  - db/index.js importDb()               (full-DB import from an export file)
//  - db/migrate.js importLegacyMain()     (one-time legacy db.json import)
//
// Semantics: drop data that belongs to removed providers or standalone media
// services (embedding/image/tts/stt/webSearch/webFetch/video/music). Preserve
// everything LLM: connections, nodes, combos, aliases, custom models,
// disabled models, pricing, settings, and usage history (usage is never
// filtered here — history survives the removal).
//
// Provider ids: Qoder was removed under BOTH ids it persisted under — the
// registry id "qoder" (connections, settings sections) and its model-string
// alias "qd" (model strings, customModels keys, disabled/pricing keys).
// NVIDIA removal covers ONLY the direct provider id "nvidia" / NIM catalog.
// Model-id matching is first-segment-only ("kgw/nvidia/nemotron" under the
// kilo-gateway alias stays untouched — never match "nvidia/" mid-string).

export const REMOVED_PROVIDERS = new Set(["qoder", "qd", "nvidia"]);

export const MEDIA_KINDS = new Set([
  "embedding", "image", "tts", "stt", "webSearch", "webFetch", "video", "music",
]);

export function isRemovedProvider(providerId) {
  return REMOVED_PROVIDERS.has(providerId);
}

// "provider/model" string whose provider segment is a removed provider.
// Only the segment before the FIRST "/" is matched.
export function isRemovedModelString(modelStr) {
  if (typeof modelStr !== "string") return false;
  const slash = modelStr.indexOf("/");
  if (slash <= 0) return false;
  return isRemovedProvider(modelStr.slice(0, slash));
}

// providerConnections rows/objects: drop removed providers.
export function sanitizeProviderConnections(list) {
  if (!Array.isArray(list)) return list;
  return list.filter((c) => c && !isRemovedProvider(c.provider));
}

// providerNodes: drop media node types (custom-embedding).
export function sanitizeProviderNodes(list) {
  if (!Array.isArray(list)) return list;
  return list.filter((n) => n && n.type !== "custom-embedding");
}

// combos: drop media kinds entirely; for kept combos, strip members that
// route to a removed provider ("qd/auto", "nvidia/nim", …) and drop the combo
// when nothing is left (an empty combo would resolve a dead provider).
export function sanitizeCombos(list) {
  if (!Array.isArray(list)) return list;
  const out = [];
  for (const c of list) {
    if (!c || (c.kind && c.kind !== "llm")) continue;
    if (Array.isArray(c.models)) {
      const models = c.models.filter((m) => !isRemovedModelString(m));
      if (models.length === 0) continue;
      out.push(models.length === c.models.length ? c : { ...c, models });
    } else {
      out.push(c);
    }
  }
  return out;
}

// modelAliases: two persisted directions exist —
//   key=alias,    value=modelString  (PUT /api/models/alias)
//   key=modelString, value=alias     (PUT /api/models)
// Drop an entry when EITHER side is a removed-provider model string.
export function sanitizeModelAliases(aliasObj) {
  if (!aliasObj || typeof aliasObj !== "object") return aliasObj;
  const out = {};
  for (const [key, value] of Object.entries(aliasObj)) {
    if (isRemovedModelString(key) || isRemovedModelString(value)) continue;
    out[key] = value;
  }
  return out;
}

// customModels list: drop entries for removed providers or media types
// (type defaults to "llm" when absent — those are preserved).
export function sanitizeCustomModels(list) {
  if (!Array.isArray(list)) return list;
  return list.filter((m) => {
    if (!m) return false;
    if (isRemovedProvider(m.providerAlias)) return false;
    return !MEDIA_KINDS.has(m.type || "llm");
  });
}

// disabledModels object {provider: [ids]}: drop removed providers entirely.
export function sanitizeDisabledModels(disabledObj) {
  if (!disabledObj || typeof disabledObj !== "object") return disabledObj;
  const out = {};
  for (const [provider, ids] of Object.entries(disabledObj)) {
    if (isRemovedProvider(provider)) continue;
    out[provider] = ids;
  }
  return out;
}

// pricing object {provider: {model: {...}}}: drop removed providers.
export function sanitizePricing(pricingObj) {
  if (!pricingObj || typeof pricingObj !== "object") return pricingObj;
  const out = {};
  for (const [provider, models] of Object.entries(pricingObj)) {
    if (isRemovedProvider(provider)) continue;
    out[provider] = models;
  }
  return out;
}

// settings object: strip per-provider keys for removed providers in
// providerStrategies / quotaVisibility. Media combo strategies are NOT
// stripped (combo names are not reliably identifiable without reading the
// combos table; stale entries are inert).
export function sanitizeSettings(settings) {
  if (!settings || typeof settings !== "object") return settings;
  const out = { ...settings };
  for (const key of ["providerStrategies", "quotaVisibility"]) {
    const section = out[key];
    if (section && typeof section === "object" && !Array.isArray(section)) {
      const next = { ...section };
      let changed = false;
      for (const providerId of Object.keys(next)) {
        if (isRemovedProvider(providerId)) {
          delete next[providerId];
          changed = true;
        }
      }
      if (changed) out[key] = next;
    }
  }
  return out;
}

// Convenience: sanitize a full export/import payload (importDb shape).
export function sanitizeImportPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const next = { ...payload };
  if (Array.isArray(payload.providerConnections)) next.providerConnections = sanitizeProviderConnections(payload.providerConnections);
  if (Array.isArray(payload.providerNodes)) next.providerNodes = sanitizeProviderNodes(payload.providerNodes);
  if (Array.isArray(payload.combos)) next.combos = sanitizeCombos(payload.combos);
  if (payload.modelAliases && typeof payload.modelAliases === "object") next.modelAliases = sanitizeModelAliases(payload.modelAliases);
  if (Array.isArray(payload.customModels)) next.customModels = sanitizeCustomModels(payload.customModels);
  if (payload.disabled && typeof payload.disabled === "object") next.disabled = sanitizeDisabledModels(payload.disabled);
  if (payload.pricing && typeof payload.pricing === "object") next.pricing = sanitizePricing(payload.pricing);
  if (payload.settings && typeof payload.settings === "object") next.settings = sanitizeSettings(payload.settings);
  return next;
}
