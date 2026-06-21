import { makeKv } from "../helpers/kvStore.js";

const overridesKv = makeKv("modelOverrides");

// Key format: `${providerAlias}|${modelId}`
function overrideKey(providerAlias, modelId) {
  return `${providerAlias}|${modelId}`;
}

/**
 * Get a single model's metadata override.
 * @param {string} providerAlias
 * @param {string} modelId
 * @returns {Promise<object|null>}
 */
export async function getModelOverride(providerAlias, modelId) {
  return await overridesKv.get(overrideKey(providerAlias, modelId));
}

/**
 * Get all model overrides, optionally filtered by provider.
 * @param {string} [providerAlias]
 * @returns {Promise<Record<string,object>>}
 */
export async function getModelOverrides(providerAlias) {
  const all = await overridesKv.getAll();
  if (!providerAlias) return all;
  return Object.fromEntries(
    Object.entries(all).filter(([k]) => k.startsWith(`${providerAlias}|`))
  );
}

/**
 * Set a model metadata override (shallow merge with existing).
 * @param {string} providerAlias
 * @param {string} modelId
 * @param {object} override - fields to override (contextWindow, maxOutput, reasoning, etc.)
 */
export async function setModelOverride(providerAlias, modelId, override) {
  const existing = await getModelOverride(providerAlias, modelId);
  await overridesKv.set(overrideKey(providerAlias, modelId), { ...existing, ...override });
}

/**
 * Delete a model metadata override.
 * @param {string} providerAlias
 * @param {string} modelId
 */
export async function deleteModelOverride(providerAlias, modelId) {
  await overridesKv.remove(overrideKey(providerAlias, modelId));
}
