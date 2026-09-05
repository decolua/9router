// Runtime capability overrides for user-added custom models.
//
// WHY THIS EXISTS: getCapabilitiesForModel(provider, model) is called from many
// places deep in the translator/thinking pipeline (thinkingUnified, thinkingLevels,
// chatCore, combo, ...) that do NOT have access to the DB or the per-request
// custom-model record. Custom-model vision/reasoning caps are a stable property of
// the model (not per-request), so we register them here keyed by `provider|model`
// the first time a request for that model is handled, and the resolver consults
// this map as its highest-priority source.
//
// Concurrency: values are model-stable (same model -> same caps), so a late writer
// can only overwrite with identical data. Reads never block. Fail-open everywhere.

const overrides = new Map();

function key(provider, model) {
  const p = provider || "";
  const m = model || "";
  // also index the vendor-prefix-stripped base model so lookups that pass either
  // "alias/model" or "model" both resolve.
  return `${p}|${m}`;
}

/**
 * Register (or refresh) capability overrides for a custom model.
 * @param {string} provider  resolved provider id (as seen by getCapabilitiesForModel)
 * @param {string} model     model id (may include vendor prefix)
 * @param {object|null} caps  e.g. { vision:true, reasoning:true }
 */
export function registerCustomModelCaps(provider, model, caps) {
  if (!caps || typeof caps !== "object") return;
  const base = model && model.includes("/") ? model.split("/").pop() : model;
  overrides.set(key(provider, model), caps);
  if (base && base !== model) overrides.set(key(provider, base), caps);
}

/** Look up overrides for a model, or null. Tries full id then base id. */
export function getCustomModelCapsOverride(provider, model) {
  if (!model) return null;
  const direct = overrides.get(key(provider, model));
  if (direct) return direct;
  const base = model.includes("/") ? model.split("/").pop() : model;
  return overrides.get(key(provider, base)) || null;
}

/** Test helper: clear the registry. */
export function _clearCustomModelCaps() {
  overrides.clear();
}
