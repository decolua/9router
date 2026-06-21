import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getModelOverride } from "../../lib/db/repos/modelOverridesRepo.js";

/**
 * Resolve model capabilities with manual override precedence.
 *
 * Fallback chain (highest priority wins):
 *   1. Manual override (DB) — user/dashboard edits
 *   2. Hardcoded provider/exact/pattern/default — source code
 *
 * @param {string} provider - 9router provider alias
 * @param {string} model - model ID
 * @returns {Promise<object>} full capabilities object (always complete, never null)
 */
export async function resolveModelMetadata(provider, model) {
  const base = getCapabilitiesForModel(provider, model);

  try {
    const override = await getModelOverride(provider, model);
    if (!override) return base;

    return { ...base, ...override };
  } catch {
    // DB unavailable — fall back to hardcoded capabilities
    return base;
  }
}
