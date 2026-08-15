// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }

      const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
      const matchedEmbedding = embeddingNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedEmbedding) {
        return { provider: matchedEmbedding.id, model: parsed.model };
      }
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  return getModelInfoCore(modelStr, getModelAliases);
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}

/**
 * Resolve band names (e.g. "haiku", "claude-haiku-4-5") to combo names.
 * Maps Anthropic model IDs to operator combos for agent-team support.
 * Only applies the mapping if the target combo actually exists; returns
 * the original string unchanged if not found (safety property).
 *
 * @param {string} modelStr - Model string (bare band name or Anthropic model ID)
 * @param {Function} comboChecker - Optional async function to check combo existence (for testing)
 * @returns {Promise<string>} Resolved combo name or original string
 */
export async function resolveBandToCombo(modelStr, comboChecker = null) {
  if (!modelStr || modelStr.includes("/")) return modelStr;

  const lower = modelStr.toLowerCase();

  let band, defaultCombo;

  if (lower === "fable" || lower.startsWith("claude-fable-")) {
    band = "NINER_BAND_FABLE";
    defaultCombo = "Odin";
  } else if (lower === "haiku" || lower.startsWith("claude-haiku-")) {
    band = "NINER_BAND_HAIKU";
    defaultCombo = "Sleipnir";
  } else if (lower === "sonnet" || lower.startsWith("claude-sonnet-")) {
    band = "NINER_BAND_SONNET";
    defaultCombo = "Valkyrie";
  } else if (lower === "opus" || lower.startsWith("claude-opus-")) {
    band = "NINER_BAND_OPUS";
    defaultCombo = "Fenrir";
  } else {
    return modelStr;
  }

  const mappedCombo = process.env[band] || defaultCombo;

  // Verify the mapped combo actually exists before applying
  const checker = comboChecker || getComboModels;
  const exists = await checker(mappedCombo);
  if (exists) {
    return mappedCombo;
  }

  return modelStr;
}
