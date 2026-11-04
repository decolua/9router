// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes, getProviderConnections } from "@/lib/localDb";
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

/**
 * Resolve a provider prefix (id, alias, or aliases) to the canonical provider id
 * Returns the provider id if found in REGISTRY, otherwise returns the prefix as-is
 * (for provider-node custom prefixes that aren't in the built-in registry)
 */
function resolveProviderPrefixToId(prefix) {
  for (const entry of REGISTRY) {
    if (entry.id === prefix || entry.alias === prefix || (entry.aliases || []).includes(prefix)) {
      return entry.id;
    }
  }
  return prefix; // Not a known registry prefix (e.g., custom provider-node)
}

/**
 * Check if a provider (by id) has noAuth flag in registry
 */
function isProviderNoAuth(providerId) {
  for (const entry of REGISTRY) {
    if (entry.id === providerId) {
      return entry.noAuth === true;
    }
  }
  return false;
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
  if (!combo || !combo.models || combo.models.length === 0) {
    return null;
  }

  // Filter out models whose provider has no active connections
  const connections = await getProviderConnections({ isActive: true });
  const providersWithActiveConnections = new Set(connections.map((c) => c.provider));

  const filteredModels = combo.models.filter((modelStr) => {
    const slash = modelStr.indexOf("/");
    if (slash <= 0) return true; // Keep non-provider/model format (nested combos, etc.)
    const providerPrefix = modelStr.slice(0, slash);

    // Resolve prefix to canonical provider id (handles aliases like "oc" -> "opencode", "cc" -> "claude")
    const providerId = resolveProviderPrefixToId(providerPrefix);

    // Keep if provider is noAuth (e.g., opencode, devin-cli, etc.)
    if (isProviderNoAuth(providerId)) return true;

    // Keep if provider has active connection (match by canonical id)
    if (providersWithActiveConnections.has(providerId)) return true;

    // Provider not in registry (custom provider-node) -> keep (no way to verify connection)
    const isKnownRegistry = REGISTRY.some((e) => e.id === providerId);
    if (!isKnownRegistry) return true;

    return false; // Known provider, not noAuth, no active connection
  });

  if (filteredModels.length === 0) {
    return null; // No models with active connections
  }
  return filteredModels;
}
