// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes } from "@/lib/localDb";
import { parseModel, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import { getRequestComboByName, getRequestModelAliases, getRequestProviderNodes } from "./requestContext.js";

export { parseModel };

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias, requestContext = null) {
  const aliases = requestContext
    ? await getRequestModelAliases(requestContext)
    : await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr, requestContext = null) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    if (parsed.provider === parsed.providerAlias) {
      // Check OpenAI Compatible nodes
      const openaiNodes = requestContext
        ? await getRequestProviderNodes("openai-compatible", requestContext)
        : await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      // Check Anthropic Compatible nodes
      const anthropicNodes = requestContext
        ? await getRequestProviderNodes("anthropic-compatible", requestContext)
        : await getProviderNodes({ type: "anthropic-compatible" });
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
  const combo = requestContext
    ? await getRequestComboByName(parsed.model, requestContext)
    : await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  return getModelInfoCore(
    modelStr,
    requestContext ? () => getRequestModelAliases(requestContext) : getModelAliases,
  );
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr, requestContext = null) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = requestContext
    ? await getRequestComboByName(modelStr, requestContext)
    : await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
