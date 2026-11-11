/**
 * Checks if a model is an OpenCode free model or an explicit free tier model.
 * Only returns true for genuine free models (e.g. beam-free, glm-5.3-flash-free, big-pickle, union-alpha).
 * Paid models (e.g. claude, gpt, deepseek-pro) return false.
 * @param {string|object} model - Model object or string ID
 * @param {string} [providerId] - Provider ID or alias
 * @param {boolean} [explicitIsFree] - Explicit isFree flag
 * @returns {boolean}
 */
export function isOpencodeFreeModel(model, providerId = "", explicitIsFree = undefined) {
  if (explicitIsFree === true) return true;
  if (explicitIsFree === false) return false;

  const cleanPid = String(providerId || "").toLowerCase();
  if (cleanPid === "deepai" || cleanPid === "dai" || cleanPid.startsWith("dai/") || cleanPid.startsWith("deepai/")) {
    return true;
  }

  const rawId = typeof model === "string" ? model : (model?.id || model?.value || model?.name || "");
  const lower = String(rawId).toLowerCase();

  if (typeof model === "object" && model !== null && model.isFree === true) {
    return true;
  }

  if (lower.startsWith("dai/") || lower.startsWith("deepai/")) {
    return true;
  }

  if (
    /(^|[-_/:])(free|contributor|preview-?free)([-_]|$)/i.test(lower) ||
    lower.includes("big-pickle") ||
    lower.includes("union-alpha")
  ) {
    return true;
  }

  return false;
}

// Backward-compatible alias: only returns "free" or "" (no PAID, no UNKNOWN)
export function resolveModelTier(model, providerId = "", explicitIsFree = undefined) {
  return isOpencodeFreeModel(model, providerId, explicitIsFree) ? "free" : "";
}
