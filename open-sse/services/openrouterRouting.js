import {
  OPENROUTER_QUANTIZATIONS,
  OPENROUTER_QUANTIZATION_FAMILIES,
  OPENROUTER_ROUTING_ENDPOINTS,
  OPENROUTER_UNDISCLOSED_PRECISION_MODELS,
} from "../config/openrouterRouting.js";

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${name} must be an object`);
}

function quantizations(value) {
  if (!Array.isArray(value) || !value.length || value.some(q => !OPENROUTER_QUANTIZATIONS.includes(q))) {
    invalid("OpenRouter quantizations must be a non-empty array of supported formats");
  }
  return [...new Set(value)];
}

export function normalizeOpenRouterRouting(value) {
  if (value === null) return null;
  object(value, "OpenRouter routing policy");
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "quantizations") result[key] = quantizations(entry);
    else if (["zdr", "allowImageWithoutZdr", "allowVideoWithoutZdr"].includes(key)) {
      if (typeof entry !== "boolean") invalid(`OpenRouter ${key} must be a boolean`);
      if (entry) result[key] = true;
    } else invalid(`Unknown OpenRouter routing setting: ${key}`);
  }
  return Object.keys(result).length ? result : null;
}

function intersectFormats(configured, requested) {
  const expand = q => OPENROUTER_QUANTIZATION_FAMILIES[q] || [q];
  const allowed = new Set(configured.flatMap(expand));
  const requestedFormats = new Set(requested.flatMap(expand));
  const intersection = [...allowed].filter(q => requestedFormats.has(q));
  if (!intersection.length) invalid("OpenRouter request quantizations conflict with the configured routing policy");
  // Preserve family labels only when the complete family is permitted.
  return intersection.filter(q => !Object.entries(OPENROUTER_QUANTIZATION_FAMILIES)
    .some(([family, members]) => q !== family && members.includes(q) && members.every(m => intersection.includes(m))));
}

export function applyOpenRouterRouting(body, policy, endpoint) {
  const capabilities = OPENROUTER_ROUTING_ENDPOINTS[endpoint];
  if (!capabilities) invalid("Unknown OpenRouter routing endpoint");
  const configured = policy == null ? {} : normalizeOpenRouterRouting(policy) || {};
  const supplied = body.provider;
  if (supplied != null) object(supplied, "OpenRouter provider preferences");
  const preferences = { ...(supplied || {}) };
  if (preferences.zdr != null && typeof preferences.zdr !== "boolean") invalid("OpenRouter provider.zdr must be a boolean");
  const requestedFormats = preferences.quantizations == null ? null : quantizations(preferences.quantizations);
  const requiresZdr = configured.zdr === true || preferences.zdr === true;

  if (!capabilities.zdr) {
    if (requiresZdr && (preferences.zdr === true || !configured[capabilities.exception])) {
      invalid(`${capabilities.reason}. This route is blocked by the ZDR requirement.`);
    }
    // An exception waives only the saved requirement, never a caller's ZDR request.
    return body;
  }
  if (requiresZdr) preferences.zdr = true;
  const models = [body.model, ...(Array.isArray(body.models) ? body.models : [])].filter(model => model != null);
  const undisclosedPrecision = models.length > 0 && models.every(model => typeof model === "string"
    && OPENROUTER_UNDISCLOSED_PRECISION_MODELS.some(pattern => pattern.test(model)));
  if (capabilities.precision && configured.quantizations && !undisclosedPrecision) {
    preferences.quantizations = requestedFormats
      ? intersectFormats(configured.quantizations, requestedFormats)
      : [...configured.quantizations];
  }
  if (!Object.keys(preferences).length) return body;
  return { ...body, provider: preferences };
}
