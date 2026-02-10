"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { useTranslations } from "next-intl";

// Provider order: OAuth first, then API Key (matches dashboard/providers)
const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

export default function ModelSelectModal({
  isOpen,
  onClose,
  onSelect,
  selectedModel,
  activeProviders = [],
  title,
  modelAliases = {},
}) {
  const t = useTranslations();
  const [searchQuery, setSearchQuery] = useState("");
  const [combos, setCombos] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [providerModelState, setProviderModelState] = useState({});

  const fetchCombos = async () => {
    try {
      const res = await fetch("/api/combos");
      if (!res.ok) throw new Error(`Failed to fetch combos: ${res.status}`);
      const data = await res.json();
      setCombos(data.combos || []);
    } catch (error) {
      console.error("Error fetching combos:", error);
      setCombos([]);
    }
  };

  useEffect(() => {
    if (isOpen) fetchCombos();
  }, [isOpen]);

  const fetchProviderNodes = async () => {
    try {
      const res = await fetch("/api/provider-nodes");
      if (!res.ok) throw new Error(`Failed to fetch provider nodes: ${res.status}`);
      const data = await res.json();
      setProviderNodes(data.nodes || []);
    } catch (error) {
      console.error("Error fetching provider nodes:", error);
      setProviderNodes([]);
    }
  };

  useEffect(() => {
    if (isOpen) fetchProviderNodes();
  }, [isOpen]);

  const connectionsByProvider = useMemo(() => {
    return (activeProviders || []).reduce((acc, connection) => {
      if (!connection?.id || !connection?.provider) return acc;
      if (connection.isActive === false) return acc;
      if (!acc[connection.provider]) acc[connection.provider] = [];
      acc[connection.provider].push(connection);
      return acc;
    }, {});
  }, [activeProviders]);

  const fetchModelsForProvider = useCallback(async (providerId, connections) => {
    if (!connections?.length) return;
    setProviderModelState(prev => ({
      ...prev,
      [providerId]: {
        ...prev[providerId],
        loading: true,
        error: false,
      },
    }));

    const results = await Promise.allSettled(
      connections.map(async (connection) => {
        const res = await fetch(`/api/providers/${connection.id}/models`);
        if (!res.ok) {
          let errorMessage = "";
          try {
            const errorData = await res.json();
            errorMessage = errorData?.error;
          } catch (error) {
            console.log("Error parsing models response:", error);
          }
          throw new Error(errorMessage || `Failed to fetch models: ${res.status}`);
        }
        return res.json();
      })
    );

    const modelMap = new Map();
    let hasSuccess = false;

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        hasSuccess = true;
        const models = result.value.models || [];
        models.forEach((model) => {
          const modelId = model.id || model.model || model.name;
          if (!modelId) return;
          if (!modelMap.has(modelId)) {
            modelMap.set(modelId, { id: modelId, name: model.name || modelId });
          }
        });
      } else {
        console.log(`Error fetching models for ${providerId}:`, result.reason);
      }
    });

    setProviderModelState(prev => ({
      ...prev,
      [providerId]: {
        loading: false,
        error: !hasSuccess,
        models: Array.from(modelMap.values()),
      },
    }));
  }, []);

  const fetchAllProviderModels = useCallback(async () => {
    const providerEntries = Object.entries(connectionsByProvider);
    if (providerEntries.length === 0) return;
    await Promise.all(
      providerEntries.map(([providerId, connections]) =>
        fetchModelsForProvider(providerId, connections)
      )
    );
  }, [connectionsByProvider, fetchModelsForProvider]);

  useEffect(() => {
    if (isOpen) fetchAllProviderModels();
  }, [isOpen, fetchAllProviderModels]);

  const allProviders = useMemo(() => ({ ...OAUTH_PROVIDERS, ...APIKEY_PROVIDERS }), []);

  const mergeModels = (...lists) => {
    const seen = new Set();
    const result = [];
    lists.forEach((list) => {
      list.forEach((model) => {
        if (!model?.value) return;
        if (seen.has(model.value)) return;
        seen.add(model.value);
        result.push(model);
      });
    });
    return result;
  };

  // Group models by provider with priority order
  const groupedModels = useMemo(() => {
    const groups = {};
    
    // Get all active provider IDs from connections
    const activeConnectionIds = activeProviders.map(p => p.provider);
    
    // Only show connected providers (including both standard and custom)
    const providerIdsToShow = new Set([
      ...activeConnectionIds,  // Only connected providers
    ]);

    // Sort by PROVIDER_ORDER
    const sortedProviderIds = [...providerIdsToShow].sort((a, b) => {
      const indexA = PROVIDER_ORDER.indexOf(a);
      const indexB = PROVIDER_ORDER.indexOf(b);
      return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    sortedProviderIds.forEach((providerId) => {
      const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
      const providerInfo = allProviders[providerId] || { name: providerId, color: "#666" };
      const isCustomProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);
      const providerState = providerModelState[providerId] || {};
      const fetchedModels = providerState.models || [];
      const fetchedEntries = fetchedModels.map((model) => {
        const valuePrefix = isCustomProvider ? providerId : alias;
        return {
          id: model.id,
          name: model.name || model.id,
          value: `${valuePrefix}/${model.id}`,
        };
      });
      const status = {
        loading: !!providerState.loading,
        error: !!providerState.error,
      };
      
      if (providerInfo.passthroughModels) {
        const aliasModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${alias}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${alias}/`, ""),
            name: aliasName,
            value: fullModel,
          }));
        
        const mergedModels = mergeModels(aliasModels, fetchedEntries);

        if (mergedModels.length > 0 || status.loading || status.error) {
          // Check for custom name from providerNodes (for compatible providers)
          const matchedNode = providerNodes.find(node => node.id === providerId);
          const displayName = matchedNode?.name || providerInfo.name;
          
          groups[providerId] = {
            name: displayName,
            alias: alias,
            color: providerInfo.color,
            models: mergedModels,
            ...status,
          };
        }
      } else if (isCustomProvider) {
        // Match provider node to get custom name
        const matchedNode = providerNodes.find(node => node.id === providerId);
        const displayName = matchedNode?.name || providerInfo.name;
        
        // Get models from modelAliases using providerId (not prefix)
        // modelAliases format: { alias: "providerId/modelId" }
        const nodeModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${providerId}/`, ""),
            name: aliasName,
            value: fullModel,
          }));

        const mergedModels = mergeModels(nodeModels, fetchedEntries);
        
        // Only add to groups if there are models (consistent with other provider types)
        if (mergedModels.length > 0 || status.loading || status.error) {
          groups[providerId] = {
            name: displayName,
            alias: matchedNode?.prefix || providerId,
            color: providerInfo.color,
            models: mergedModels,
            isCustom: true,
            hasModels: mergedModels.length > 0,
            ...status,
          };
        }
      } else {
        const models = getModelsByProviderId(providerId);
        if (models.length > 0) {
          const builtInModels = models.map((m) => ({
            id: m.id,
            name: m.name,
            value: `${alias}/${m.id}`,
          }));
          const mergedModels = mergeModels(builtInModels, fetchedEntries);
          groups[providerId] = {
            name: providerInfo.name,
            alias: alias,
            color: providerInfo.color,
            models: mergedModels,
            ...status,
          };
        }
      }
    });

    return groups;
  }, [activeProviders, modelAliases, allProviders, providerNodes, providerModelState]);

  // Filter combos by search query
  const filteredCombos = useMemo(() => {
    if (!searchQuery.trim()) return combos;
    const query = searchQuery.toLowerCase();
    return combos.filter(c => c.name.toLowerCase().includes(query));
  }, [combos, searchQuery]);

  // Filter models by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedModels;

    const query = searchQuery.toLowerCase();
    const filtered = {};

    Object.entries(groupedModels).forEach(([providerId, group]) => {
      const matchedModels = group.models.filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.id.toLowerCase().includes(query)
      );

      const providerNameMatches = group.name.toLowerCase().includes(query);
      
      if (matchedModels.length > 0 || providerNameMatches) {
        filtered[providerId] = {
          ...group,
          models: matchedModels,
        };
      }
    });

    return filtered;
  }, [groupedModels, searchQuery]);

  const handleSelect = (model) => {
    onSelect(model);
    onClose();
    setSearchQuery("");
  };

  const handleRetry = (providerId) => {
    const connections = connectionsByProvider[providerId] || [];
    fetchModelsForProvider(providerId, connections);
  };

  const resolvedTitle = title || t("modelSelect.title");

  return (
      <Modal
        isOpen={isOpen}
        onClose={() => {
          onClose();
          setSearchQuery("");
        }}
        title={resolvedTitle}
        size="md"
        className="p-4!"
      >
      {/* Search - compact */}
      <div className="mb-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">
            search
          </span>
          <input
            type="text"
            placeholder={t("modelSelect.searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-surface border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Models grouped by provider - compact */}
      <div className="max-h-[300px] overflow-y-auto space-y-3">
        {/* Combos section - always first */}
        {filteredCombos.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
              <span className="material-symbols-outlined text-primary text-[14px]">layers</span>
              <span className="text-xs font-medium text-primary">{t("modelSelect.combos")}</span>
              <span className="text-[10px] text-text-muted">({filteredCombos.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filteredCombos.map((combo) => {
                const isSelected = selectedModel === combo.name;
                return (
                  <button
                    key={combo.id}
                    onClick={() => handleSelect({ id: combo.name, name: combo.name, value: combo.name })}
                    className={`
                      px-2 py-1 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer
                      ${isSelected 
                        ? "bg-primary text-white border-primary" 
                        : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
                      }
                    `}
                  >
                    {combo.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Provider models */}
        {Object.entries(filteredGroups).map(([providerId, group]) => (
          <div key={providerId}>
            {/* Provider header */}
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: group.color }}
              />
              <span className="text-xs font-medium text-primary">
                {group.name}
              </span>
              <span className="text-[10px] text-text-muted">
                ({group.models.length})
              </span>
            </div>

            {group.loading && (
              <div className="flex items-center gap-2 text-[11px] text-text-muted mb-2">
                <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                <span>{t("modelSelect.loadingProvider")}</span>
              </div>
            )}

            {!group.loading && group.error && (
              <div className="flex items-center gap-2 text-[11px] text-red-500 mb-2">
                <span className="material-symbols-outlined text-[14px]">error</span>
                <span>{t("modelSelect.loadFailed")}</span>
                <button
                  type="button"
                  onClick={() => handleRetry(providerId)}
                  className="ml-1 text-[11px] text-primary hover:underline"
                >
                  {t("common.retry")}
                </button>
              </div>
            )}

            {!group.loading && !group.error && group.models.length === 0 && (
              <div className="flex items-center gap-2 text-[11px] text-text-muted mb-2">
                <span className="material-symbols-outlined text-[14px]">info</span>
                <span>{t("modelSelect.noModelsForProvider")}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              {group.models.map((model) => {
                const isSelected = selectedModel === model.value;
                return (
                  <button
                    key={model.id}
                    onClick={() => handleSelect(model)}
                    className={`
                      px-2 py-1 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer
                      ${isSelected 
                        ? "bg-primary text-white border-primary" 
                        : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
                      }
                    `}
                  >
                    {model.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {Object.keys(filteredGroups).length === 0 && filteredCombos.length === 0 && (
          <div className="text-center py-4 text-text-muted">
            <span className="material-symbols-outlined text-2xl mb-1 block">
              search_off
            </span>
            <p className="text-xs">{t("modelSelect.noModelsFound")}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

ModelSelectModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  selectedModel: PropTypes.string,
  activeProviders: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string.isRequired,
    })
  ),
  title: PropTypes.string,
  modelAliases: PropTypes.object,
};

