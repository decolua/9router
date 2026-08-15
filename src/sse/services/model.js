// Re-export from open-sse with localDb integration
import { getModelAliases, getCustomModels, getComboByName, getProviderNodes } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore, resolveProviderAlias, resolveBareModelStaticOwner } from "open-sse/services/model.js";
import { lookupBareModel as lookupOpencodeBareModel } from "@/lib/opencodeCatalog";
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

  // Bare (provider-less) model name: resolve to whichever provider actually
  // serves it (custom registry → static catalog → opencode free catalog),
  // before the generic prefix-inference fallback can blind-route it to the
  // wrong provider.
  const dynamic = await resolveBareModelToProvider(parsed.model);
  if (dynamic) {
    return dynamic;
  }

  return getModelInfoCore(modelStr, getModelAliases);
}

/**
 * Dynamic fallback for bare (provider-less) model names, in priority order:
 * 1. admin-registered custom models (explicit intent — wins over everything),
 * 2. user-defined model aliases (explicit intent — wins over catalog hits),
 * 3. static registry declarations (deterministic, no admin data needed),
 * 4. connection-less live catalogs (opencode free tier — fetched + cached).
 * This replaces the brittle hardcoded prefix→provider inference for opencode
 * free tier, mimo, and any other connection-less/providerless provider — a
 * bare name resolves to the real owner instead of being blind-routed to a
 * provider that will reject it.
 */
export async function resolveBareModelToProvider(modelStr) {
  try {
    const custom = await getCustomModels();
    const hit = custom.find(
      (m) => m && m.id === modelStr && (m.type === "llm" || !m.type)
    );
    if (hit && hit.providerAlias) {
      const provider = resolveProviderAlias(hit.providerAlias);
      return { provider, model: hit.id };
    }
  } catch {
    /* fail open: fall through to normal resolution */
  }

  // 2) user-defined model aliases — explicit intent, must win over catalog hits
  try {
    const aliases = await getModelAliases();
    const aliasHit = resolveModelAliasFromMap(modelStr, aliases);
    if (aliasHit) return aliasHit;
  } catch {
    /* fail open: fall through to normal resolution */
  }

  const staticOwner = resolveBareModelStaticOwner(modelStr);
  if (staticOwner) {
    return { provider: staticOwner, model: modelStr };
  }

  try {
    const oc = await lookupOpencodeBareModel(modelStr);
    if (oc) return oc;
  } catch {
    /* fail open: fall through to normal resolution */
  }

  return null;
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
