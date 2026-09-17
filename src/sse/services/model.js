// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes, getProviderConnections } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore } from "open-sse/services/model.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import * as log from "../utils/logger.js";

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
    return filterUnavailableComboMembers(combo.models);
  }
  return null;
}

// A catalog is account-specific. A combo member remains runnable when at least
// one active account either has not been catalogued yet or still lists it. This
// deliberately preserves the stored combo: sync only changes routing, never a
// user's fallback order or aliases. Matching is prefix-aware: gateways report
// ids like `anthropic/claude-sonnet-5` while the member may carry only the
// trailing segment.
function catalogEntryIdMatches(entry, model) {
  const candidate = String(entry?.id || "");
  if (!candidate) return false;
  const bare = model.includes("/") ? model.split("/").pop() : model;
  if (candidate === model || candidate === bare) return true;
  const candidateBare = candidate.includes("/") ? candidate.split("/").pop() : candidate;
  return candidateBare === bare;
}

function catalogListsModel(catalogModels, providerId, model) {
  return (catalogModels || []).some((entry) => {
    if (!entry || entry.availability === "unavailable") return false;
    return catalogEntryIdMatches(entry, model);
  });
}

function catalogKnowsModel(catalogModels, model) {
  return (catalogModels || []).some((entry) => catalogEntryIdMatches(entry, model));
}

function connectionHasSyncedCatalog(connection) {
  // A failed first sync writes `{ models: [], lastError }` with no lastSuccessAt.
  // That is not a catalog: treating it as one would strip every combo member.
  return Array.isArray(connection.modelCatalog?.models) && Boolean(connection.modelCatalog.lastSuccessAt);
}

function providerIsPassthrough(providerId) {
  return REGISTRY.some((entry) => entry.id === providerId && entry.passthroughModels === true);
}

async function filterUnavailableComboMembers(models) {
  const connections = await getProviderConnections({ isActive: true });
  const candidates = await Promise.all(models.map(async (member) => {
    const info = await getModelInfo(member);
    if (!info?.provider || !info?.model) return member;
    const accounts = connections.filter((connection) => connection.provider === info.provider);
    if (!accounts.length) return member;
    const catalogued = accounts.filter(connectionHasSyncedCatalog);
    if (!catalogued.length) return member;
    const availableSomewhere = catalogued.some((connection) =>
      catalogListsModel(connection.modelCatalog.models, info.provider, info.model)
    );
    if (availableSomewhere) return member;
    // Passthrough providers accept ids the listing never heard of (Cline
    // remaps, user-typed aggregators). Only drop a member that the catalog
    // actually listed and then marked unavailable.
    if (providerIsPassthrough(info.provider)) {
      const knownSomewhere = catalogued.some((connection) =>
        catalogKnowsModel(connection.modelCatalog.models, info.model)
      );
      if (!knownSomewhere) return member;
    }
    const unverifiedSomewhere = accounts.length > catalogued.length;
    return unverifiedSomewhere ? member : null;
  }));
  // Fail-open. The catalog is a routing hint, never an authority over a combo
  // the user configured: a stale sync, a paginated listing or a plan-scoped
  // listing can mark every member "unavailable" and erase the whole fallback
  // chain. When nothing survives, route the stored members and let the provider
  // return the real error — that is strictly more informative than a synthetic
  // 503, and it keeps `getComboModels`'s contract (non-empty array, or null).
  const kept = candidates.filter(Boolean);
  if (kept.length > 0) return kept;
  log.warn("COMBO", `every member filtered out by catalog sync — routing the stored combo as-is (${models.join(", ")})`);
  return [...models];
}
