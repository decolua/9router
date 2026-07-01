/**
 * Pure helpers extracted from ModelSelectModal so the model grouping logic
 * (especially the openai-/anthropic-compatible provider branch) can be unit
 * tested without rendering React.
 *
 * The compatible-provider branch historically only read modelAliases, so
 * models registered via the "Import from /models" button on the provider
 * detail page (which lands in /api/models/custom) never appeared in the
 * combo model picker. See buildCompatibleProviderGroup below for the fix.
 */

import {
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  AI_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  getProviderAlias,
} from "../constants/providers.js";
import { getModelsByProviderId, getModelKind } from "../constants/models.js";

// Provider order: OAuth first, then Free Tier, then API Key (matches dashboard/providers)
export const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

// Providers that need no auth — always show in model selector
export const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter(
  (id) => FREE_PROVIDERS[id].noAuth
);

// Kinds where the provider IS the model (no per-model selection needed)
const PROVIDER_AS_MODEL_KINDS = new Set(["webSearch", "webFetch"]);
// Kinds that map directly to model.type field
const TYPED_KINDS = new Set(["image", "tts", "stt", "embedding", "imageToText"]);
// For these kinds, providers without hardcoded models can still be picked (provider-as-model fallback)
const ALLOW_PROVIDER_FALLBACK_KINDS = new Set(["tts", "image", "webFetch"]);

function filterByKind(models, kindFilter) {
  // No kindFilter means the LLM selector. Keep custom models visible because
  // user-added models may have typed capabilities (for example imageToText)
  // while still being valid chat/combo targets.
  if (!kindFilter)
    return models.filter(
      (m) =>
        m.isPlaceholder || m.isCustom || !getModelKind(m) || getModelKind(m) === "llm"
    );
  if (!TYPED_KINDS.has(kindFilter)) return models;
  return models.filter((m) => m.isPlaceholder || getModelKind(m) === kindFilter);
}

/**
 * Build the per-provider group entry for openai-/anthropic-compatible providers.
 *
 * Compatible providers store:
 *  - aliases under key "openai-compatible-...|anthropic-compatible-.../<model>" in /api/models/alias
 *  - imported (via "Import from /models") entries under the same generated
 *    providerId in /api/models/custom (see CompatibleModelsSection.js + provider page)
 *
 * Both must surface in the picker; otherwise combo configuration hides
 * imported models for compatible providers like the user's "open-claude".
 *
 * @param {string} providerId - the generated compatible provider id, e.g. "anthropic-compatible-<uuid>"
 * @param {Array} activeProviders - active provider connections
 * @param {Array} providerNodes - configured provider nodes
 * @param {Object} modelAliases - aliasName -> fullModel map from /api/models/alias
 * @param {Array} customModels - entries from /api/models/custom ({ providerAlias, id, name, type })
 * @param {Object} providerInfo - resolved provider display info (name, color, ...)
 * @returns {{ name: string, alias: string, color: string, models: Array, isCustom: boolean, hasModels: boolean }}
 */
export function buildCompatibleProviderGroup({
  providerId,
  activeProviders,
  providerNodes,
  modelAliases,
  customModels,
  providerInfo,
}) {
  const connection = activeProviders.find((p) => p.provider === providerId);
  const matchedNode = providerNodes.find((node) => node.id === providerId);
  const displayName = matchedNode?.name || connection?.name || providerInfo.name;
  const nodePrefix =
    connection?.providerSpecificData?.prefix || matchedNode?.prefix || providerId;

  // Aliases are stored with the raw providerId as key
  // (e.g. "openai-compatible-chat-<uuid>/glm-4.7"), so filter by providerId,
  // not by the display prefix.
  const aliasModels = Object.entries(modelAliases)
    .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
    .map(([aliasName, fullModel]) => {
      const modelId = fullModel.replace(`${providerId}/`, "");
      return {
        id: modelId,
        name: aliasName,
        value: `${nodePrefix}/${modelId}`,
      };
    });

  // Custom (imported) models: for compatible providers, /api/models/custom rows
  // store providerAlias === providerId (the generated compatible id), per the
  // provider detail page. They must be merged here so combo configuration
  // surfaces every imported model, not just the legacy alias-keyed ones.
  const aliasValues = new Set(aliasModels.map((m) => m.value));
  const aliasIds = new Set(aliasModels.map((m) => m.id));
  const customRegisteredModels = (customModels || [])
    .filter(
      (m) =>
        m.providerAlias === providerId &&
        !aliasIds.has(m.id) &&
        !aliasValues.has(`${nodePrefix}/${m.id}`)
    )
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      value: `${nodePrefix}/${m.id}`,
      isCustom: true,
    }));

  const combined = [...aliasModels, ...customRegisteredModels];

  // Always show connected compatible providers even with no models; the
  // placeholder tells users the provider is available and lets them type
  // a model id.
  const modelsToShow =
    combined.length > 0
      ? combined
      : [
          {
            id: `__placeholder__${providerId}`,
            name: `${nodePrefix}/model-id`,
            value: `${nodePrefix}/model-id`,
            isPlaceholder: true,
          },
        ];

  return {
    name: displayName,
    alias: nodePrefix,
    color: providerInfo.color,
    models: modelsToShow,
    isCustom: true,
    hasModels: combined.length > 0,
  };
}

/**
 * Build the full { providerId -> group } map used by the model picker UI.
 *
 * Pure: every input is an argument. `customModels`, `modelAliases`, etc.
 * are passed in (the React component fetches them via useEffect, this
 * helper just shapes them).
 */
export function buildGroupedModels({
  filteredActiveProviders,
  modelAliases = {},
  customModels = [],
  providerNodes = [],
  disabledModels = {},
  kindFilter = null,
  allProviders,
}) {
  const providersCatalog = allProviders || {
    ...OAUTH_PROVIDERS,
    ...FREE_PROVIDERS,
    ...FREE_TIER_PROVIDERS,
    ...APIKEY_PROVIDERS,
  };

  const groups = {};

  // No-auth providers: filter by kindFilter as well
  const noAuthIds = kindFilter
    ? NO_AUTH_PROVIDER_IDS.filter((id) =>
        (AI_PROVIDERS[id]?.serviceKinds || ["llm"]).includes(kindFilter)
      )
    : NO_AUTH_PROVIDER_IDS;

  // Only show connected providers (including both standard and custom)
  const providerIdsToShow = new Set([
    ...filteredActiveProviders.map((p) => p.provider),
    ...noAuthIds,
  ]);

  // Sort by PROVIDER_ORDER
  const sortedProviderIds = [...providerIdsToShow].sort((a, b) => {
    const indexA = PROVIDER_ORDER.indexOf(a);
    const indexB = PROVIDER_ORDER.indexOf(b);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });

  for (const providerId of sortedProviderIds) {
    const alias = getProviderAlias(providerId);
    const providerInfo = providersCatalog[providerId] || {
      name: providerId,
      color: "#666",
    };
    const isCustomProvider =
      isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

    // For provider-as-model kinds (webSearch/webFetch): emit a single entry
    if (kindFilter && PROVIDER_AS_MODEL_KINDS.has(kindFilter)) {
      groups[providerId] = {
        name: providerInfo.name,
        alias,
        color: providerInfo.color,
        models: [{ id: providerId, name: providerInfo.name, value: providerId }],
      };
      continue;
    }

    if (providerInfo.passthroughModels) {
      // Passthrough branch — unchanged from original
      const aliasModels = Object.entries(modelAliases)
        .filter(([, fullModel]) => fullModel.startsWith(`${alias}/`))
        .map(([aliasName, fullModel]) => ({
          id: fullModel.replace(`${alias}/`, ""),
          name: aliasName,
          value: fullModel,
        }));
      const customRegisteredModels = customModels
        .filter((m) => m.providerAlias === alias)
        .map((m) => ({
          id: m.id,
          name: m.name || m.id,
          value: `${alias}/${m.id}`,
          kind: getModelKind(m),
          isCustom: true,
        }));

      let combined = aliasModels;
      if (kindFilter && TYPED_KINDS.has(kindFilter)) {
        const registeredTyped = customRegisteredModels.filter(
          (m) => getModelKind(m) === kindFilter
        );
        combined = [
          ...registeredTyped,
          ...getModelsByProviderId(providerId)
            .filter((m) => getModelKind(m) === kindFilter)
            .map((m) => ({
              id: m.id,
              name: m.name,
              value: `${alias}/${m.id}`,
              kind: getModelKind(m),
            }))
            .filter((m) => !registeredTyped.some((r) => r.value === m.value)),
        ];
        if (
          combined.length === 0 &&
          ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)
        ) {
          const supports = (providerInfo.serviceKinds || ["llm"]).includes(kindFilter);
          if (supports) combined = [{ id: providerId, name: providerInfo.name, value: alias }];
        }
      } else {
        const registeredLlms = customRegisteredModels.filter(
          (m) => !getModelKind(m) || getModelKind(m) === "llm"
        );
        const seen = new Set([...aliasModels, ...registeredLlms].map((m) => m.value));
        const hardcoded = getModelsByProviderId(providerId)
          .filter((m) => !getModelKind(m) || getModelKind(m) === "llm")
          .map((m) => ({
            id: m.id,
            name: m.name,
            value: `${alias}/${m.id}`,
            kind: getModelKind(m),
          }))
          .filter((m) => !seen.has(m.value));
        combined = [
          ...registeredLlms,
          ...aliasModels.filter(
            (m) => !registeredLlms.some((r) => r.value === m.value)
          ),
          ...hardcoded,
        ];
      }

      if (combined.length > 0) {
        const matchedNode = providerNodes.find((node) => node.id === providerId);
        const displayName = matchedNode?.name || providerInfo.name;
        groups[providerId] = {
          name: displayName,
          alias,
          color: providerInfo.color,
          models: combined,
        };
      }
      continue;
    }

    if (isCustomProvider) {
      // Custom (openai/anthropic-compatible) providers are LLM-only — skip typed media kinds
      if (kindFilter && TYPED_KINDS.has(kindFilter)) continue;
      groups[providerId] = buildCompatibleProviderGroup({
        providerId,
        activeProviders: filteredActiveProviders,
        providerNodes,
        modelAliases,
        customModels,
        providerInfo,
      });
      continue;
    }

    // Standard provider branch
    const hardcodedModels = getModelsByProviderId(providerId);
    const hardcodedIds = new Set(hardcodedModels.map((m) => m.id));

    const hasHardcoded = hardcodedModels.length > 0;
    const customAliasModels = Object.entries(modelAliases)
      .filter(
        ([aliasName, fullModel]) =>
          fullModel.startsWith(`${alias}/`) &&
          (hasHardcoded ? aliasName === fullModel.replace(`${alias}/`, "") : true) &&
          !hardcodedIds.has(fullModel.replace(`${alias}/`, ""))
      )
      .map(([aliasName, fullModel]) => {
        const modelId = fullModel.replace(`${alias}/`, "");
        return { id: modelId, name: aliasName, value: fullModel, isCustom: true };
      });

    const customAliasIds = new Set(customAliasModels.map((m) => m.id));
    const customRegisteredModels = customModels
      .filter(
        (m) =>
          m.providerAlias === alias &&
          !hardcodedIds.has(m.id) &&
          !customAliasIds.has(m.id)
      )
      .map((m) => ({
        id: m.id,
        name: m.name || m.id,
        value: `${alias}/${m.id}`,
        isCustom: true,
      }));

    const merged = [
      ...hardcodedModels.map((m) => ({
        id: m.id,
        name: m.name,
        value: `${alias}/${m.id}`,
        kind: getModelKind(m),
      })),
      ...customAliasModels,
      ...customRegisteredModels,
    ];

    const seen = new Set();
    let allModels = filterByKind(
      merged.filter((m) => {
        if (seen.has(m.value)) return false;
        seen.add(m.value);
        return true;
      }),
      kindFilter
    );

    if (
      allModels.length === 0 &&
      kindFilter &&
      ALLOW_PROVIDER_FALLBACK_KINDS.has(kindFilter)
    ) {
      const supports = (providerInfo.serviceKinds || ["llm"]).includes(kindFilter);
      if (supports) allModels = [{ id: providerId, name: providerInfo.name, value: alias }];
    }

    if (allModels.length > 0) {
      groups[providerId] = {
        name: providerInfo.name,
        alias,
        color: providerInfo.color,
        models: allModels,
      };
    }
  }

  // Filter out disabled models per provider
  for (const [providerId, group] of Object.entries(groups)) {
    const aliasKey = getProviderAlias(providerId);
    const disabledIds = new Set([
      ...(disabledModels[aliasKey] || []),
      ...(disabledModels[providerId] || []),
    ]);
    if (disabledIds.size === 0) continue;
    group.models = group.models.filter((m) => !disabledIds.has(m.id));
    if (group.models.length === 0) delete groups[providerId];
  }

  return groups;
}
