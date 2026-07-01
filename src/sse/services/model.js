// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

// Built-in provider ids/aliases that user-defined node prefixes must not shadow
// (e.g. `cf`, `cloudflare-ai`, `openai`, `hf`).
const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
for (const entry of REGISTRY) {
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

/**
 * Map a provider-node prefix (e.g. custom "mm") to the actual node id.
 * Returns { provider: nodeId, model } when a compatible node matches, else null.
 */
async function matchNodeByPrefix(prefix, model) {
  if (!prefix) return null;
  const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
  const o = openaiNodes.find((node) => node.prefix === prefix);
  if (o) return { provider: o.id, model };

  const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
  const a = anthropicNodes.find((node) => node.prefix === prefix);
  if (a) return { provider: a.id, model };

  const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
  const e = embeddingNodes.find((node) => node.prefix === prefix);
  if (e) return { provider: e.id, model };

  return null;
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
    // Map a custom node prefix (openai/anthropic/embedding compatible) to its node id.
    // Provider-node prefixes are user-defined and must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const nodeMatch = await matchNodeByPrefix(parsed.providerAlias, parsed.model);
      if (nodeMatch) return nodeMatch;
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

  // Resolve the alias to its target, then map a custom node prefix if the
  // target points at a compatible node (e.g. alias → "mm/mimo-v2.5-pro").
  const aliases = await getModelAliases();
  const resolved = resolveModelAliasFromMap(parsed.model, aliases);
  if (resolved) {
    const nodeMatch = await matchNodeByPrefix(resolved.provider, resolved.model);
    if (nodeMatch) return nodeMatch;
    return resolved;
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
