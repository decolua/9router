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

  // Always check combo FIRST, before any provider/alias resolution.
  // This allows prefixed models like "9router/free-mix" to trigger combo routing.
  const combo = await getComboByName(parsed.model);
  if (combo) {
    return { provider: null, model: parsed.model };
  }

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

    // Try alias resolution as fallback for provider/model format
    // This allows aliasing models like "deepseek/deepseek-v4-flash" which
    // get parsed as provider/model but need to be redirected to another provider
    const aliases = await getModelAliases();

    // Check if full model string (e.g. "deepseek/deepseek-v4-flash") has an alias
    if (aliases && aliases[modelStr]) {
      const resolved = resolveModelAliasFromMap(modelStr, aliases);
      if (resolved) return resolved;
    }

    // Check if just the model part (e.g. "deepseek-v4-flash") has an alias
    if (aliases && aliases[parsed.model]) {
      const resolved = resolveModelAliasFromMap(parsed.model, aliases);
      if (resolved) return resolved;
    }

    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  return getModelInfoCore(modelStr, getModelAliases);
}

/**
 * Build a mapping from provider name/id/connectionId to node prefix.
 * Used to normalize combo model objects into routable "prefix/model" strings.
 */
async function buildProviderPrefixMap() {
  const map = {};
  const allNodes = await getProviderNodes();
  for (const node of allNodes) {
    if (!node.prefix) continue;
    // Map by node ID
    if (node.id) map[node.id] = node.prefix;
    // Map by node name (case-insensitive)
    if (node.name) map[node.name.toLowerCase()] = node.prefix;
  }
  return map;
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  // If model comes with provider prefix (e.g. "9router/free-mix"),
  // extract just the model name for combo lookup
  const comboName = modelStr.includes("/") ? modelStr.split("/").pop() : modelStr;

  const combo = await getComboByName(comboName);
  if (combo && combo.models && combo.models.length > 0) {
    // Build prefix map to resolve provider names/IDs to routable prefixes
    const prefixMap = await buildProviderPrefixMap();

    // Normalize: combo models can be strings or objects {provider, connectionId, model, priority}
    // Must build "prefix/model" format for proper routing through getModelInfo
    return combo.models.map(m => {
      if (typeof m === 'string') return m;
      if (typeof m === 'object' && m.model) {
        // Try to find the node prefix for this provider
        const providerKey = m.provider;
        if (providerKey) {
          // Try direct match (by ID) then case-insensitive name match
          const prefix = prefixMap[providerKey] || prefixMap[providerKey.toLowerCase()];
          if (prefix) return `${prefix}/${m.model}`;
          // Fallback: use provider ID directly (may be node ID)
          return `${providerKey}/${m.model}`;
        }
        return m.model;
      }
      return String(m);
    });
  }
  return null;
}
