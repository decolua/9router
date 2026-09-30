/**
 * A Model Studio name is a model of its own to the caller. Whatever answered behind it
 * stays internal: the console, the request details and the provider logs keep the real
 * target, while every payload that leaves the gateway names the model that was called.
 */

const MODEL_KEYS = ["model", "modelVersion"];
// Claude nests the name under message_start's message, Responses under its response object.
const NESTED_KEYS = ["message", "response"];

/**
 * The name a response should carry, or null when the caller already spoke the resolved
 * model and there is nothing to hide.
 */
export function calledModelName(requestedModel, model) {
  const alias = typeof requestedModel === "string" ? requestedModel.trim() : "";
  if (!alias || alias === model) return null;
  return alias;
}

/**
 * Overwrite every model field of one decoded payload, nested ones included. Returns true
 * when the payload was rewritten, so callers know they have to re-serialise it.
 */
export function applyModelAlias(payload, alias) {
  if (!alias || !payload || typeof payload !== "object") return false;
  let changed = false;
  for (const key of MODEL_KEYS) {
    if (typeof payload[key] === "string" && payload[key] !== alias) {
      payload[key] = alias;
      changed = true;
    }
  }
  for (const key of NESTED_KEYS) {
    const nested = payload[key];
    if (nested && typeof nested === "object" && applyModelAlias(nested, alias)) changed = true;
  }
  return changed;
}
