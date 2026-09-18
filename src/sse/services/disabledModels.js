// Runtime enforcement for models disabled in the dashboard.
//
// Until now `disabledModels` was only read by the listing endpoints
// (/api/models, /v1/models) and the model picker, so disabling a model just hid
// it from the UI while combos and direct /v1 calls kept routing to it.
//
// The disabled ids are stored keyed by the provider's storage alias (built-in
// providers) or by the raw providerId (openai/anthropic-compatible nodes), so
// every lookup has to try both — the same rule ModelSelectModal uses.
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { getProviderAlias } from "@/shared/constants/providers.js";
import { getModelInfo } from "./model.js";
import * as log from "../utils/logger.js";

/**
 * Read the full disabled map. Fails open — a DB hiccup must never take routing
 * down, it just means nothing is treated as disabled for that request.
 * @returns {Promise<Record<string, string[]>>}
 */
export async function getDisabledModelMap() {
  try {
    return await getDisabledModels();
  } catch (error) {
    log.warn("MODELS", `Could not read disabled models: ${error.message}`);
    return {};
  }
}

/**
 * Check a resolved provider/model pair against an already-loaded map.
 */
export function isDisabledInMap(disabledMap, provider, model) {
  if (!disabledMap || !provider || !model) return false;
  const ids = [
    ...(disabledMap[getProviderAlias(provider)] || []),
    ...(disabledMap[provider] || []),
  ];
  return ids.includes(model);
}

/**
 * Hard gate for the single-model path.
 * @param {string} provider - Resolved provider id
 * @param {string} model - Resolved model id
 * @returns {Promise<boolean>} true when the model must not be routed
 */
export async function isModelDisabled(provider, model) {
  return isDisabledInMap(await getDisabledModelMap(), provider, model);
}

/**
 * Drop disabled entries from a combo model list before the fallback loop runs,
 * so a disabled model never costs a round trip. Entries that don't resolve to a
 * concrete provider (nested combo names) are kept untouched — the single-model
 * gate catches those further down.
 * @param {string[]} models
 * @returns {Promise<string[]>}
 */
export async function filterDisabledModels(models) {
  if (!Array.isArray(models) || models.length === 0) return models;

  const disabledMap = await getDisabledModelMap();
  if (Object.keys(disabledMap).length === 0) return models;

  const kept = [];
  for (const modelStr of models) {
    let info = null;
    try {
      info = await getModelInfo(modelStr);
    } catch {
      // Unresolvable entry — keep it and let the normal path report the error.
    }
    if (info?.provider && isDisabledInMap(disabledMap, info.provider, info.model)) {
      log.debug("MODELS", `Skipping disabled model "${modelStr}"`);
      continue;
    }
    kept.push(modelStr);
  }
  return kept;
}
