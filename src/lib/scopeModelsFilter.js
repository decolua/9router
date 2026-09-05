// Post-filter for /v1/models-style responses — NEW file. Applied by the
// route handlers AFTER they build their normal (unscoped) model list, so
// buildModelsList() itself never has to know about scoping.
import { isFullModelIdAllowed } from "./apiKeyScope.js";

/**
 * @param {Array<{id: string}>} models - catalog entries as built by buildModelsList()
 * @param {object|null} scope - the requesting key's scope, or null/undefined for unrestricted
 */
export function filterModelsByScope(models, scope) {
  if (!scope || !Array.isArray(models)) return models;
  return models.filter((m) => isFullModelIdAllowed(scope, m?.id));
}
