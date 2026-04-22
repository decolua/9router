import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import {
  OAUTH_PROVIDERS,
  APIKEY_PROVIDERS,
  FREE_PROVIDERS,
  FREE_TIER_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
} from "@/shared/constants/providers";

const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter((id) => FREE_PROVIDERS[id].noAuth);

export function buildGroupedSelectableModels({ activeProviders = [], modelAliases = {}, providerNodes = [] } = {}) {
  const groups = {};
  const allProviders = {
    ...OAUTH_PROVIDERS,
    ...FREE_PROVIDERS,
    ...FREE_TIER_PROVIDERS,
    ...APIKEY_PROVIDERS,
  };

  const activeConnectionIds = activeProviders.map((provider) => provider.provider);
  const providerIdsToShow = new Set([...activeConnectionIds, ...NO_AUTH_PROVIDER_IDS]);

  const sortedProviderIds = [...providerIdsToShow].sort((a, b) => {
    const indexA = PROVIDER_ORDER.indexOf(a);
    const indexB = PROVIDER_ORDER.indexOf(b);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });

  sortedProviderIds.forEach((providerId) => {
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
    const providerInfo = allProviders[providerId] || { name: providerId, color: "#666" };
    const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

    if (providerInfo.passthroughModels) {
      const aliasModels = Object.entries(modelAliases)
        .filter(([, fullModel]) => fullModel.startsWith(`${alias}/`))
        .map(([aliasName, fullModel]) => ({
          id: fullModel.replace(`${alias}/`, ""),
          name: aliasName,
          value: fullModel,
        }));

      if (aliasModels.length > 0) {
        const matchedNode = providerNodes.find((node) => node.id === providerId);
        const displayName = matchedNode?.name || providerInfo.name;

        groups[providerId] = {
          name: displayName,
          alias,
          color: providerInfo.color,
          models: aliasModels,
        };
      }

      return;
    }

    if (isCustomProvider) {
      const connection = activeProviders.find((provider) => provider.provider === providerId);
      const matchedNode = providerNodes.find((node) => node.id === providerId);
      const displayName = connection?.name || matchedNode?.name || providerInfo.name;
      const nodePrefix = connection?.providerSpecificData?.prefix || matchedNode?.prefix || providerId;

      const nodeModels = Object.entries(modelAliases)
        .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
        .map(([aliasName, fullModel]) => ({
          id: fullModel.replace(`${providerId}/`, ""),
          name: aliasName,
          value: `${nodePrefix}/${fullModel.replace(`${providerId}/`, "")}`,
        }));

      groups[providerId] = {
        name: displayName,
        alias: nodePrefix,
        color: providerInfo.color,
        models: nodeModels.length > 0
          ? nodeModels
          : [{
              id: `__placeholder__${providerId}`,
              name: `${nodePrefix}/model-id`,
              value: `${nodePrefix}/model-id`,
              isPlaceholder: true,
            }],
        isCustom: true,
        hasModels: nodeModels.length > 0,
      };

      return;
    }

    const hardcodedModels = getModelsByProviderId(providerId);
    const hardcodedIds = new Set(hardcodedModels.map((model) => model.id));
    const hasHardcoded = hardcodedModels.length > 0;

    const customModels = Object.entries(modelAliases)
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

    const allModels = [
      ...hardcodedModels.map((model) => ({ id: model.id, name: model.name, value: `${alias}/${model.id}` })),
      ...customModels,
    ];

    if (allModels.length > 0) {
      groups[providerId] = {
        name: providerInfo.name,
        alias,
        color: providerInfo.color,
        models: allModels,
      };
    }
  });

  return groups;
}

export function extractSelectableModelValues(groupedModels = {}) {
  return Array.from(
    new Set(
      Object.values(groupedModels)
        .flatMap((group) => group.models || [])
        .filter((model) => model?.value && !model.isPlaceholder)
        .map((model) => model.value)
    )
  ).sort((left, right) => left.localeCompare(right));
}
