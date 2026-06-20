// Ported from OmniRoute open-sse/services/autoCombo/autoPrefix.ts.
// Parses the `auto[/<variant>]` model prefix used by Routing Intelligence.
// The variant drives the autoCombo engine's strategy selection downstream.

export const VALID_VARIANTS = ["coding", "fast", "cheap", "offline", "smart", "lkgp"];

/**
 * Parse a model name to detect the auto prefix and extract its variant.
 *
 *   "auto"         -> { valid: true }                       (default)
 *   "auto/coding"  -> { valid: true, variant: "coding" }
 *   "auto/lkgp"    -> { valid: true, variant: "lkgp" }
 *   "auto/"        -> { valid: true }                       (default)
 *   "autocoding"   -> { valid: false, error: "..." }
 *   "otherModel"   -> { valid: false, error: "..." }
 *
 * @param {string|null|undefined} model
 * @returns {{ valid: boolean, variant?: string, error?: string }}
 */
export function parseAutoPrefix(model) {
  if (typeof model !== "string") {
    return { valid: false, error: "Not an auto-prefixed model" };
  }
  if (!model.startsWith("auto")) {
    return { valid: false, error: "Not an auto-prefixed model" };
  }

  const parts = model.split("/");

  if (parts.length === 1) {
    if (parts[0] === "auto") return { valid: true }; // default auto
    return { valid: false, error: "Invalid auto prefix format" };
  }

  if (parts.length === 2) {
    if (parts[0] !== "auto") return { valid: false, error: "Invalid auto prefix format" };
    const variantStr = parts[1];
    if (variantStr === "" || VALID_VARIANTS.includes(variantStr)) {
      return variantStr === "" ? { valid: true } : { valid: true, variant: variantStr };
    }
    return { valid: false, error: `Invalid auto variant: ${variantStr}` };
  }

  return { valid: false, error: "Invalid auto prefix format" };
}
