// Unified speed-tier normalization: extract client intent → apply provider-native field.
// Config-driven: which models have a faster tier comes from capabilities.js
// (`speedFormat`), never hardcoded per-model here. Mirrors thinkingUnified.js.
//
// Providers expose "run the same model faster" under different names, so the
// capability names the wire format and this module maps it to the native field:
//   claude-speed → body.speed = "fast"   (Anthropic fast mode)
//
// Intent is a "-fast" marker on the model id. It sits before the thinking suffix so
// the two compose: "claude-opus-5-fast(low)" → model "claude-opus-5(low)" + fast tier.

import { getCapabilitiesForModel } from "../../providers/capabilities.js";

// "-fast", optionally followed by a thinking suffix "(level)".
const SPEED_SUFFIX_RE = /-fast(\([^()]*\))?\s*$/;

// speedFormat → the provider-native body field/value pair.
const FORMAT_FIELDS = {
  "claude-speed": { field: "speed", value: "fast" },
};

// True when the model id opts into the faster tier.
export function hasSpeedSuffix(model) {
  return typeof model === "string" && SPEED_SUFFIX_RE.test(model);
}

// Drop the "-fast" marker, keeping any thinking suffix intact (no-op when absent).
// "claude-opus-5-fast(low)" → "claude-opus-5(low)"; "gpt-5.6-sol-fast" → "gpt-5.6-sol".
export function stripSpeedSuffix(model) {
  if (typeof model !== "string") return model;
  return model.replace(SPEED_SUFFIX_RE, (_, thinkingSuffix) => thinkingSuffix || "");
}

/**
 * Set the provider-native speed field on an already-translated body, in place.
 *
 * Call only when the request opted in (see `hasSpeedSuffix`); `body.model` is
 * expected to be the real upstream id by this point. When the model has no
 * `speedFormat` capability this is a no-op and the request runs at standard
 * speed — a model that never had the tier (or lost it, as Opus 4.7 did) must not
 * fail the whole request.
 *
 * @returns {boolean} true when a speed field was applied.
 */
export function applySpeed(provider, body) {
  if (!body || typeof body !== "object") return false;
  const { speedFormat } = getCapabilitiesForModel(provider, body.model);
  const spec = FORMAT_FIELDS[speedFormat];
  if (!spec) return false;
  body[spec.field] = spec.value;
  return true;
}
