// Model-set resolution for dashboard callers that need "the models a user can
// currently route to". The rules mirror ModelSelectModal's picker memo (kept in
// sync by hand for now — adopting this module there is the follow-up that would
// make it a single source). Promoting them out of the CLI tool card is what
// stops "Add All Active Models" from drifting away from the picker: anything
// the picker knows from runtime data (no-auth free providers, user aliases,
// registered custom models, live per-account catalogs, disabled models) used to
// be invisible to other callers.
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import {
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  AI_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  getProviderAlias,
} from "@/shared/constants/providers";
import { getDeactivatedProviderIds } from "@/shared/utils/connectionStatus";

// Provider order: OAuth first, then Free Tier, then API Key (matches dashboard/providers)
export const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

// Providers that need no auth — always selectable, and they never own a
// connection row, so any caller that only walks connections misses them.
export const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter((id) => FREE_PROVIDERS[id].noAuth);

// Providers with per-account live catalogs via /api/providers/[id]/models.
// Static registry stays as fallback when live fetch fails or is empty.
// zed added in #4244: its backend customResolver already returns live models
// but the frontend omitted it, hiding Zed entirely from the Combo picker.
export const LIVE_CATALOG_PROVIDERS = ["cursor", "cline", "clinepass", "zed"];

export const ALL_PROVIDERS = { ...OAUTH_PROVIDERS, ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...APIKEY_PROVIDERS };

const asArray = (value) => (Array.isArray(value) ? value : []);

/**
 * Build the grouped, ordered, filtered model list shown by the pickers.
 *
 * @param {object} input
 * @param {Array} [input.connections]     Active connections, already filtered by kind (optional).
 * @param {Array} [input.allConnections]  Every connection, used to resolve custom-provider display names.
 * @param {string|null} [input.kindFilter]  e.g. "image" | "webSearch"; null/undefined = LLM picker.
 * @param {object} [input.modelAliases]   aliasName -> "providerAlias/modelId"
 * @param {Array}  [input.providerNodes]  Compatible-provider nodes
 * @param {Array}  [input.customModels]   Rows from /api/models/custom
 * @param {object} [input.disabledModels] alias -> [modelId]
 * @param {object} [input.liveModels]     { cursor: [], cline: [], clinepass: [], zed: [] }
 * @returns {Object<string, {name: string, alias: string, color: string, models: Array}>}
 */
export function buildModelGroups({
  connections,
  allConnections,
  kindFilter = null,
  modelAliases = {},
  providerNodes = [],
  customModels = [],
  disabledModels = {},
  liveModels = {},
  providers = ALL_PROVIDERS,
} = {}) {
  const filteredActiveProviders = asArray(connections);
  const effectiveConnections = asArray(allConnections ?? connections);
  const providerNodesSafe = asArray(providerNodes);
  const customModelsSafe = asArray(customModels);
  const modelAliasesSafe = modelAliases || {};
  const disabledModelsSafe = disabledModels || {};
  const allProviders = providers || ALL_PROVIDERS;
  // Paused providers (every connection of theirs is inactive) drop out; providers
  // with no connection row at all stay, e.g. keyless local endpoints.
  const deactivatedProviderIds = getDeactivatedProviderIds(effectiveConnections);
  const live = liveModels || {};
  const cursorModels = asArray(live.cursor);
  const clineModels = asArray(live.cline);
  const clinepassModels = asArray(live.clinepass);
  const zedModels = asArray(live.zed);

  const groups = {};

  // Kinds where the provider IS the model (no per-model selection needed)
  const PROVIDER_AS_MODEL_KINDS = new Set(["webSearch", "webFetch"]);
  // Kinds that map directly to model.type field
  const TYPED_KINDS = new Set(["image", "tts", "stt", "embedding", "imageToText", "systemone"]);
  // For these kinds, providers without hardcoded models can still be picked (provider-as-model fallback)
  const ALLOW_PROVIDER_FALLBACK_KINDS = new Set(["tts", "image", "webFetch"]);

  // Filter a models[] array by kindFilter (keep only matching kind)
  const filterByKind = (models) => {
    // No kindFilter means the LLM selector. Keep custom models visible because
    // user-added models may have typed capabilities (for example imageToText)
    // while still being valid chat/combo targets.
    if (!kindFilter) return models.filter((m) => m.isPlaceholder || m.isCustom || !getModelKind(m) || getModelKind(m) === "llm");
    if (!TYPED_KINDS.has(kindFilter)) return models;
    return models.filter((m) => m.isPlaceholder || getModelKind(m) === kindFilter);
  };

  // Get all active provider IDs from connections (filtered by kindFilter if set)
  const activeConnectionIds = filteredActiveProviders.map(p => p.provider);

  // No-auth providers: filter by kindFilter as well
  const noAuthIds = (kindFilter
    ? NO_AUTH_PROVIDER_IDS.filter((id) => (AI_PROVIDERS[id]?.serviceKinds || ["llm"]).includes(kindFilter))
    : NO_AUTH_PROVIDER_IDS).filter((id) => !deactivatedProviderIds.has(id));

  // Compatible nodes (OpenAI/Anthropic Compatible) that already have user-added
  // custom models should be selectable even without an API-key connection. Local /
  // self-hosted endpoints (Ollama, internal relays, etc.) don't always need a stored
  // key, so gating on connections hides models the user already added. These nodes
  // are LLM-only, so only surface them when no kind filter is active.
  // See #4177, #2113, #2119, #1988.
  const existingNodeIds = new Set((providerNodesSafe || []).map((n) => n?.id).filter(Boolean));
  const compatibleNodeIds = kindFilter
    ? []
    : customModelsSafe
        .map((m) => m.providerAlias)
        .filter((alias) =>
          (isOpenAICompatibleProvider(alias) || isAnthropicCompatibleProvider(alias)) &&
          existingNodeIds.has(alias) &&
          !deactivatedProviderIds.has(alias)
        );

  // Only show connected providers (including both standard and custom)
  const providerIdsToShow = new Set([
    ...activeConnectionIds,  // Only connected providers
    ...noAuthIds,            // No-auth providers (kind-filtered)
    ...compatibleNodeIds,    // Compatible nodes with user-added models
  ].filter((id) => !deactivatedProviderIds.has(id)));

  // Sort by PROVIDER_ORDER
  const sortedProviderIds = [...providerIdsToShow].sort((a, b) => {
    const indexA = PROVIDER_ORDER.indexOf(a);
    const indexB = PROVIDER_ORDER.indexOf(b);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });

  sortedProviderIds.forEach((providerId) => {
    const alias = getProviderAlias(providerId);
    const providerInfo = allProviders[providerId] || { name: providerId, color: "#666" };
    const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

    // For provider-as-model kinds (webSearch/webFetch): emit a single entry where value === providerId
    if (kindFilter && PROVIDER_AS_MODEL_KINDS.has(kindFilter)) {
      groups[providerId] = {
        name: providerInfo.name,
        alias,
        color: providerInfo.color,
        models: [{ id: providerId, name: providerInfo.name, value: providerId }],
      };
      return;
    }

    if (providerInfo.passthroughModels) {
      const aliasModels = Object.entries(modelAliasesSafe)
        .filter(([, fullModel]) => fullModel.startsWith(`${alias}/`))
        .map(([aliasName, fullModel]) => ({
          id: fullModel.replace(`${alias}/`, ""),
          name: aliasName,
          value: fullModel,
        }));
      const customRegisteredModels = customModelsSafe
        .filter((m) => m.providerAlias === alias)
        .map((m) => ({
          id: m.id,
          name: m.name || m.id,
          value: `${alias}/${m.id}`,
          kind: getModelKind(m),
          isCustom: true,
        }));

      // For typed kinds, only include hardcoded typed models (aliases are typically LLM-only and lack type info)
      let combined = aliasModels;
      if (kindFilter && TYPED_KINDS.has(kindFilter)) {
        const registeredTyped = customRegisteredModels.filter((m) => getModelKind(m) === kindFilter);
        combined = [
          ...registeredTyped,
          ...getModelsByProviderId(providerId)
          .filter((m) => getModelKind(m) === kindFilter)
          .map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) }))
          .filter((m) => !registeredTyped.some((registered) => registered.value === m.value)),
        ];
        // Fallback: provider-as-model when no hardcoded models match (tts/image/webFetch only)
        if (combined.length === 0 && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
          const supports = (providerInfo.serviceKinds || ["llm"]).includes(kindFilter);
          if (supports) combined = [{ id: providerId, name: providerInfo.name, value: alias }];
        }
      } else {
        // LLM/null kind: merge hardcoded models (e.g. mimo-free → mimo-auto) with user-added models
        const registeredLlms = customRegisteredModels.filter((m) => !getModelKind(m) || getModelKind(m) === "llm");
        const seen = new Set([...aliasModels, ...registeredLlms].map((m) => m.value));
        const hardcoded = getModelsByProviderId(providerId)
          .filter((m) => !getModelKind(m) || getModelKind(m) === "llm")
          .map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) }))
          .filter((m) => !seen.has(m.value));
        combined = [...registeredLlms, ...aliasModels.filter((m) => !registeredLlms.some((registered) => registered.value === m.value)), ...hardcoded];
      }

      if (combined.length > 0) {
        // Check for custom name from providerNodesSafe (for compatible providers)
        const matchedNode = providerNodesSafe.find(node => node.id === providerId);
        const displayName = matchedNode?.name || providerInfo.name;

        groups[providerId] = {
          name: displayName,
          alias: alias,
          color: providerInfo.color,
          models: combined,
        };
      }
    } else if (isCustomProvider) {
      // Custom (openai/anthropic-compatible) providers are LLM-only — skip for typed media kinds
      if (kindFilter && TYPED_KINDS.has(kindFilter)) return;
      // Find connection object to get prefix synchronously without waiting for providerNodesSafe fetch
      const connection = filteredActiveProviders.find(p => p.provider === providerId) || effectiveConnections.find(p => p.provider === providerId);
      const matchedNode = providerNodesSafe.find(node => node.id === providerId);
      const displayName = matchedNode?.name || connection?.name || providerInfo.name;
      const nodePrefix = connection?.providerSpecificData?.prefix || matchedNode?.prefix || providerId;

      // Aliases are stored using the raw providerId as key (e.g. "openai-compatible-chat-<uuid>/glm-4.7"),
      // so we must filter by providerId, not by the display prefix.
      const nodeModels = Object.entries(modelAliasesSafe)
        .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
        .map(([aliasName, fullModel]) => ({
          id: fullModel.replace(`${providerId}/`, ""),
          name: aliasName,
          value: `${nodePrefix}/${fullModel.replace(`${providerId}/`, "")}`,
        }));

      // Merge custom models registered via /api/models/custom for this provider
      // providerAlias in DB uses the raw providerId, not the display prefix
      const registeredCustom = customModelsSafe
        .filter((m) => m.providerAlias === providerId)
        .map((m) => ({
          id: m.id,
          name: m.name || m.id,
          value: `${nodePrefix}/${m.id}`,
          isCustom: true,
        }));
      const seen = new Set(nodeModels.map((m) => m.value));
      const mergedModels = [...nodeModels, ...registeredCustom.filter((m) => !seen.has(m.value))];

      // Always show compatible providers that are connected, even with no aliases.
      // When no aliases exist, show a placeholder so users know it's available.
      const modelsToShow = mergedModels.length > 0 ? mergedModels : [{
        id: `__placeholder__${providerId}`,
        name: `${nodePrefix}/model-id`,
        value: `${nodePrefix}/model-id`,
        isPlaceholder: true,
      }];

      groups[providerId] = {
        name: displayName,
        alias: nodePrefix,
        color: providerInfo.color,
        models: modelsToShow,
        isCustom: true,
        hasModels: mergedModels.length > 0,
      };
    } else {
      const liveModels = providerId === "cursor" ? cursorModels : providerId === "cline" ? clineModels : providerId === "clinepass" ? clinepassModels : providerId === "zed" ? zedModels : [];
      const hardcodedModels = liveModels.length > 0
        ? liveModels
        : getModelsByProviderId(providerId);
      const hardcodedIds = new Set(hardcodedModels.map((m) => m.id));

      // Custom models: if no hardcoded models (e.g. openrouter), show all aliases for this provider
      // Otherwise only show aliases where aliasName === modelId ("Add Model" button pattern)
      const hasHardcoded = hardcodedModels.length > 0;
      const customAliasModels = Object.entries(modelAliasesSafe)
        .filter(([aliasName, fullModel]) =>
          fullModel.startsWith(`${alias}/`) &&
          (hasHardcoded ? aliasName === fullModel.replace(`${alias}/`, "") : true) &&
          !hardcodedIds.has(fullModel.replace(`${alias}/`, ""))
        )
        .map(([aliasName, fullModel]) => {
          const modelId = fullModel.replace(`${alias}/`, "");
          return { id: modelId, name: aliasName, value: fullModel, isCustom: true };
        });

      // Custom models registered via /api/models/custom (provider "Add Model" button)
      const customAliasIds = new Set(customAliasModels.map((m) => m.id));
      const customRegisteredModels = customModelsSafe
        .filter((m) => m.providerAlias === alias && !hardcodedIds.has(m.id) && !customAliasIds.has(m.id))
        .map((m) => ({ id: m.id, name: m.name || m.id, value: `${alias}/${m.id}`, isCustom: true }));

      const merged = [
        ...hardcodedModels.map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) })),
        ...customAliasModels,
        ...customRegisteredModels,
      ];
      // Dedupe by value (alias may equal hardcoded id, causing React key collision)
      const seen = new Set();
      let allModels = filterByKind(merged.filter((m) => {
        if (seen.has(m.value)) return false;
        seen.add(m.value);
        return true;
      }));

      // Provider-as-model fallback: providers that support the kind but have no hardcoded models
      // can still be picked (value = providerAlias). Skips embedding (always needs model).
      if (allModels.length === 0 && kindFilter && ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)) {
        const supports = (providerInfo.serviceKinds || ["llm"]).includes(kindFilter);
        if (supports) {
          allModels = [{ id: providerId, name: providerInfo.name, value: alias }];
        }
      }

      if (allModels.length > 0) {
        groups[providerId] = {
          name: providerInfo.name,
          alias: alias,
          color: providerInfo.color,
          models: allModels,
        };
      }
    }
  });

  // Filter out disabled models per provider (disabled keyed by storage alias OR providerId)
  Object.entries(groups).forEach(([providerId, group]) => {
    const aliasKey = getProviderAlias(providerId);
    const disabledIds = new Set([
      ...(disabledModelsSafe[aliasKey] || []),
      ...(disabledModelsSafe[providerId] || []),
    ]);
    if (disabledIds.size === 0) return;
    group.models = group.models.filter((m) => !disabledIds.has(m.id));
    if (group.models.length === 0) delete groups[providerId];
  });

  // Filter by enabledModels if explicitly configured on any active connection for this provider
  Object.entries(groups).forEach(([providerId, group]) => {
    const providerConns = filteredActiveProviders.filter((p) => p.provider === providerId);
    const explicitEnabled = [];
    for (const conn of providerConns) {
      if (Array.isArray(conn.providerSpecificData?.enabledModels) && conn.providerSpecificData.enabledModels.length > 0) {
        explicitEnabled.push(...conn.providerSpecificData.enabledModels);
      }
    }
    if (explicitEnabled.length > 0) {
      const enabledSet = new Set(explicitEnabled);
      const alias = group.alias || getProviderAlias(providerId) || providerId;
      group.models = group.models.filter((m) =>
        enabledSet.has(m.id) ||
        enabledSet.has(m.value) ||
        enabledSet.has(`${alias}/${m.id}`) ||
        (m.value && enabledSet.has(m.value.replace(`${alias}/`, "")))
      );
      if (group.models.length === 0) delete groups[providerId];
    }
  });

  return groups;
}

/**
 * Flatten grouped models to the routing values a caller can hand to a tool
 * ("alias/model-id"). Used by "Add All Active Models"; the picker reads groups
 * directly so it keeps names/kinds.
 */
export function collectModelValues(groups) {
  const values = [];
  const seen = new Set();
  Object.values(groups || {}).forEach((group) => {
    asArray(group?.models).forEach((model) => {
      const value = typeof model === "string" ? model : model?.value;
      if (!value || seen.has(value)) return;
      seen.add(value);
      values.push(value);
    });
  });
  return values;
}
