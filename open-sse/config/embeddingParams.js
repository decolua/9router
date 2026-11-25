// Extra request params an embedding model can declare (registry models[].params).
//
// NVIDIA's asymmetric embedding models (nemotron-3.5-embed-*, nv-embedqa-*, ...)
// REQUIRE `input_type` — the upstream answers HTTP 400 with
// "'input_type' parameter is required for asymmetric models" when it is missing.
// Symmetric models (e.g. nvidia/nvclip) declare no params and must not receive one.

export const INPUT_TYPE_PARAM = "input_type";

// The only accepted values. A wrong one silently degrades retrieval accuracy,
// and an unknown one is rejected upstream — so anything else is dropped.
export const INPUT_TYPE_VALUES = ["query", "passage"];

// Default when the client sends nothing usable. "query" matches the common
// read-time usage; callers that index passages must send "passage" explicitly.
export const DEFAULT_INPUT_TYPE = "query";

/**
 * Resolve the `input_type` an embedding request should carry.
 *
 * @param {string[]} declaredParams Registry `models[].params` for the model.
 * @param {*} clientValue Raw client-supplied value (untrusted).
 * @returns {string|null} The value to send, or null when the model takes no params.
 */
export function resolveInputType(declaredParams, clientValue) {
  if (!Array.isArray(declaredParams) || !declaredParams.includes(INPUT_TYPE_PARAM)) return null;
  const raw = typeof clientValue === "string" ? clientValue.trim().toLowerCase() : "";
  return INPUT_TYPE_VALUES.includes(raw) ? raw : DEFAULT_INPUT_TYPE;
}
