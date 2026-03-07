// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes } from "@/lib/localDb";
import { parseModel, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";

export { parseModel };

/**
 * Resolve model alias from localDb
 * @param {string} alias - The alias to resolve
 * @param {string|null} userId - User ID for user-scoped aliases
 */
export async function resolveModelAlias(alias, userId = null) {
  const aliases = await getModelAliases(userId);
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * Get full model info (parse or resolve)
 * @param {string} modelStr - The model string to parse
 * @param {string|null} userId - User ID for user-scoped aliases
 */
export async function getModelInfo(modelStr, userId = null) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    if (parsed.provider === parsed.providerAlias) {
      // Check OpenAI Compatible nodes
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      // Check Anthropic Compatible nodes
      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model, userId);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  return getModelInfoCore(modelStr, () => getModelAliases(userId));
}

/**
 * Check if model is a combo and get models list
 * @param {string} modelStr - The model string to check
 * @param {string|null} userId - User ID for user-scoped combos
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr, userId = null) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr, userId);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
