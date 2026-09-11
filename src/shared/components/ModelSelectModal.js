"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import ProviderIcon from "./ProviderIcon";
import CapacityBadges from "./CapacityBadges";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, AI_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider, getProviderAlias, MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";

// Provider order: OAuth first, then Free Tier, then API Key (matches dashboard/providers)
const PROVIDER_ORDER = [
  ...Object.keys(OAUTH_PROVIDERS),
  ...Object.keys(FREE_PROVIDERS),
  ...Object.keys(FREE_TIER_PROVIDERS),
  ...Object.keys(APIKEY_PROVIDERS),
];

// Providers that need no auth — always show in model selector
const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).filter(id => FREE_PROVIDERS[id].noAuth);

// Providers with per-account live catalogs via /api/providers/[id]/models.
// Static registry stays as fallback when live fetch fails or is empty.
const LIVE_CATALOG_PROVIDERS = ["cursor", "cline", "clinepass"];

// Fetch a provider's account-scoped catalog for every active connection and merge
// the results. Entries collapse by model id on purpose: two connections of the
// same provider produce the same picker value (`alias/id`), so keeping the first
// avoids duplicate rows. There is no per-connection metadata to preserve beyond
// {id,name}. Empty array means "nothing live" so callers keep the static fallback.
function useLiveProviderModels(isOpen, connectionIds, label) {
  const [models, setModels] = useState([]);
  const idsKey = (connectionIds ?? []).join("|");

  useEffect(() => {
    const ids = idsKey ? idsKey.split("|") : [];
    if (!isOpen || ids.length === 0) {
      setModels([]);
      return undefined;
    }

    let cancelled = false;
    Promise.all(ids.map(async (connectionId) => {
      const response = await fetch(`/api/providers/${connectionId}/models`, { cache: "no-store" });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data.models) ? data.models : [];
    }))
      .then((modelLists) => {
        if (cancelled) return;
        const seen = new Set();
        setModels(modelLists.flat().filter((model) => {
          if (!model?.id || seen.has(model.id)) return false;
          seen.add(model.id);
          return true;
        }));
      })
      .catch((error) => {
        // Do not hide the static fallback when the account catalog is unavailable.
        console.warn(`Unable to load ${label} models for selector:`, error);
        if (!cancelled) setModels([]);
      });

    return () => { cancelled = true; };
  }, [isOpen, idsKey, label]);

  return models;
}

export default function ModelSelectModal({
  isOpen,
  onClose,
  onSelect,
  onDeselect,
  selectedModel,
  activeProviders = [],
  title = "Select Model",
  modelAliases = {},
  kindFilter = null,
  capFilter = null,
  addedModelValues = [],
  closeOnSelect = true,
  includeMediaKinds = false,
}) {
  const { getCaps } = useModelCaps();
  const [searchQuery, setSearchQuery] = useState("");
  const [combos, setCombos] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [customModels, setCustomModels] = useState([]);
  const [disabledModels, setDisabledModels] = useState({});
  // Cursor and Cline expose the usable catalog per account, so the static catalog is
  // kept only as a fallback: it goes stale quickly and entitlements differ per account.
  // Single map driven by LIVE_CATALOG_PROVIDERS so the constant cannot drift
  // from the memos below; per-provider arrays stay referentially stable unless
  // activeProviders itself changes.
  const liveConnectionIdsByProvider = useMemo(() => {
    const map = Object.fromEntries(LIVE_CATALOG_PROVIDERS.map((id) => [id, []]));
    for (const p of activeProviders) {
      if (p?.id && Object.prototype.hasOwnProperty.call(map, p.provider)) map[p.provider].push(p.id);
    }
    return map;
  }, [activeProviders]);
  const cursorConnectionIds = liveConnectionIdsByProvider.cursor;
  const clineConnectionIds = liveConnectionIdsByProvider.cline;
  const clinepassConnectionIds = liveConnectionIdsByProvider.clinepass;

  const cursorModels = useLiveProviderModels(isOpen, cursorConnectionIds, "Cursor");
  const clineModels = useLiveProviderModels(isOpen, clineConnectionIds, "Cline");
  const clinepassModels = useLiveProviderModels(isOpen, clinepassConnectionIds, "ClinePass");

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

  const fetchCustomModels = async () => {
    try {
      const res = await fetch("/api/models/custom");
      if (!res.ok) throw new Error(`Failed to fetch custom models: ${res.status}`);
      const data = await res.json();
      setCustomModels(data.models || []);
    } catch (error) {
      console.error("Error fetching custom models:", error);
      setCustomModels([]);
    }
  };

  useEffect(() => {
    if (isOpen) fetchCustomModels();
  }, [isOpen]);

  const fetchDisabledModels = async () => {
    try {
      const res = await fetch("/api/models/disabled");
      if (!res.ok) throw new Error(`Failed to fetch disabled models: ${res.status}`);
      const data = await res.json();
      setDisabledModels(data.disabled || {});
    } catch (error) {
      console.error("Error fetching disabled models:", error);
      setDisabledModels({});
    }
  };

  useEffect(() => {
    if (isOpen) fetchDisabledModels();
  }, [isOpen]);

  const allProviders = useMemo(() => ({ ...OAUTH_PROVIDERS, ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...APIKEY_PROVIDERS }), []);

  // Filter activeProviders by serviceKinds for a given kind (null = LLM/no filter)
  const filterActiveProvidersByKind = useCallback((kind) => {
    if (!kind) return activeProviders;
    return activeProviders.filter((p) => {
      // Custom Embedding nodes (id: custom-embedding-<uuid>) aren't registered in
      // AI_PROVIDERS, so they'd otherwise fall back to the ["llm"] default and get
      // filtered out of every non-LLM kind, including "embedding" itself.
      if (isCustomEmbeddingProvider(p.provider)) return kind === "embedding";
      const info = AI_PROVIDERS[p.provider];
      const kinds = info?.serviceKinds || ["llm"];
      return kinds.includes(kind);
    });
  }, [activeProviders]);

  // Build the provider->models group map for a given kind filter (null = LLM selector).
  // Factored out so it can be called once for the main LLM section and once per
  // media-provider kind (embedding/tts/stt/image/imageToText/webSearch/webFetch/...).
  const buildGroupsForKind = useCallback((effectiveKindFilter) => {
    const groups = {};

    // Kinds where the provider IS the model (no per-model selection needed)
    const PROVIDER_AS_MODEL_KINDS = new Set(["webSearch", "webFetch"]);
    // Kinds that map directly to model.type field
    const TYPED_KINDS = new Set(["image", "tts", "stt", "embedding", "imageToText"]);
    // For these kinds, providers without hardcoded models can still be picked (provider-as-model fallback)
    const ALLOW_PROVIDER_FALLBACK_KINDS = new Set(["tts", "image", "webFetch"]);

    // Filter a models[] array by effectiveKindFilter (keep only matching kind)
    const filterByKind = (models) => {
      // No kindFilter means the LLM selector. Keep custom models visible because
      // user-added models may have typed capabilities (for example imageToText)
      // while still being valid chat/combo targets.
      if (!effectiveKindFilter) return models.filter((m) => m.isPlaceholder || m.isCustom || !getModelKind(m) || getModelKind(m) === "llm");
      if (!TYPED_KINDS.has(effectiveKindFilter)) return models;
      return models.filter((m) => m.isPlaceholder || getModelKind(m) === effectiveKindFilter);
    };

    // Get all active provider IDs from connections (filtered by effectiveKindFilter if set)
    const kindFilteredActiveProviders = filterActiveProvidersByKind(effectiveKindFilter);
    const activeConnectionIds = kindFilteredActiveProviders.map(p => p.provider);

    // No-auth providers: filter by effectiveKindFilter as well
    const noAuthIds = effectiveKindFilter
      ? NO_AUTH_PROVIDER_IDS.filter((id) => (AI_PROVIDERS[id]?.serviceKinds || ["llm"]).includes(effectiveKindFilter))
      : NO_AUTH_PROVIDER_IDS;

    // Only show connected providers (including both standard and custom)
    const providerIdsToShow = new Set([
      ...activeConnectionIds,  // Only connected providers
      ...noAuthIds,            // No-auth providers (kind-filtered)
    ]);

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
      const isCustomEmbedding = isCustomEmbeddingProvider(providerId);

      // For provider-as-model kinds (webSearch/webFetch): emit a single entry where value === providerId
      if (effectiveKindFilter && PROVIDER_AS_MODEL_KINDS.has(effectiveKindFilter)) {
        groups[providerId] = {
          name: providerInfo.name,
          alias,
          color: providerInfo.color,
          models: [{ id: providerId, name: providerInfo.name, value: providerId }],
        };
        return;
      }

      if (providerInfo.passthroughModels) {
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

        // For typed kinds, only include hardcoded typed models (aliases are typically LLM-only and lack type info)
        let combined = aliasModels;
        if (effectiveKindFilter && TYPED_KINDS.has(effectiveKindFilter)) {
          const registeredTyped = customRegisteredModels.filter((m) => getModelKind(m) === effectiveKindFilter);
          combined = [
            ...registeredTyped,
            ...getModelsByProviderId(providerId)
            .filter((m) => getModelKind(m) === effectiveKindFilter)
            .map((m) => ({ id: m.id, name: m.name, value: `${alias}/${m.id}`, kind: getModelKind(m) }))
            .filter((m) => !registeredTyped.some((registered) => registered.value === m.value)),
          ];
          // Fallback: provider-as-model when no hardcoded models match (tts/image/webFetch only)
          if (combined.length === 0 && ALLOW_PROVIDER_FALLBACK_KINDS.has(effectiveKindFilter)) {
            const supports = (providerInfo.serviceKinds || ["llm"]).includes(effectiveKindFilter);
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
          // Check for custom name from providerNodes (for compatible providers)
          const matchedNode = providerNodes.find(node => node.id === providerId);
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
        if (effectiveKindFilter && TYPED_KINDS.has(effectiveKindFilter)) return;
        // Find connection object to get prefix synchronously without waiting for providerNodes fetch
        const connection = activeProviders.find(p => p.provider === providerId);
        const matchedNode = providerNodes.find(node => node.id === providerId);
        const displayName = matchedNode?.name || connection?.name || providerInfo.name;
        const nodePrefix = connection?.providerSpecificData?.prefix || matchedNode?.prefix || providerId;

        // Aliases are stored using the raw providerId as key (e.g. "openai-compatible-chat-<uuid>/glm-4.7"),
        // so we must filter by providerId, not by the display prefix.
        const nodeModels = Object.entries(modelAliases)
          .filter(([, fullModel]) => fullModel.startsWith(`${providerId}/`))
          .map(([aliasName, fullModel]) => ({
            id: fullModel.replace(`${providerId}/`, ""),
            name: aliasName,
            value: `${nodePrefix}/${fullModel.replace(`${providerId}/`, "")}`,
          }));

        // Merge custom models registered via /api/models/custom for this provider
        // providerAlias in DB uses the raw providerId, not the display prefix
        const registeredCustom = customModels
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
      } else if (isCustomEmbedding) {
        // Custom Embedding nodes (created via System -> Media Providers -> Embedding)
        // only ever expose embedding models, so skip them entirely for the LLM
        // selector and every other kind — same restriction AddCustomEmbeddingModal
        // and EmbeddingExampleCard already apply.
        if (effectiveKindFilter !== "embedding") return;
        const matchedNode = providerNodes.find(node => node.id === providerId);
        const connection = activeProviders.find(p => p.provider === providerId);
        const displayName = matchedNode?.name || connection?.name || providerInfo.name;
        const nodePrefix = matchedNode?.prefix || connection?.providerSpecificData?.prefix || providerId;

        // Unlike openai/anthropic-compatible nodes, custom embedding models are
        // registered via /api/models/custom with providerAlias = the node prefix,
        // not the raw providerId (see media-providers/[kind]/[id]/page.js passing
        // providerAliasOverride={customNode?.prefix} into ModelsCard).
        const registeredModels = customModels
          .filter((m) => m.providerAlias === nodePrefix && getModelKind(m, "llm") === "embedding")
          .map((m) => ({ id: m.id, name: m.name || m.id, value: `${nodePrefix}/${m.id}`, isCustom: true }));

        const modelsToShow = registeredModels.length > 0 ? registeredModels : [{
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
          hasModels: registeredModels.length > 0,
        };
      } else {
        const liveModels = providerId === "cursor" ? cursorModels : providerId === "cline" ? clineModels : providerId === "clinepass" ? clinepassModels : [];
        const hardcodedModels = liveModels.length > 0
          ? liveModels
          : getModelsByProviderId(providerId);
        const hardcodedIds = new Set(hardcodedModels.map((m) => m.id));

        // Custom models: if no hardcoded models (e.g. openrouter), show all aliases for this provider
        // Otherwise only show aliases where aliasName === modelId ("Add Model" button pattern)
        const hasHardcoded = hardcodedModels.length > 0;
        const customAliasModels = Object.entries(modelAliases)
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
        const customRegisteredModels = customModels
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
        if (allModels.length === 0 && effectiveKindFilter && ALLOW_PROVIDER_FALLBACK_KINDS.has(effectiveKindFilter)) {
          const supports = (providerInfo.serviceKinds || ["llm"]).includes(effectiveKindFilter);
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
        ...(disabledModels[aliasKey] || []),
        ...(disabledModels[providerId] || []),
      ]);
      if (disabledIds.size === 0) return;
      group.models = group.models.filter((m) => !disabledIds.has(m.id));
      if (group.models.length === 0) delete groups[providerId];
    });

    return groups;
  }, [filterActiveProvidersByKind, modelAliases, allProviders, providerNodes, customModels, disabledModels, activeProviders, cursorModels, clineModels, clinepassModels]);

  // Main section: LLM models (or whatever single kindFilter the caller passed)
  const groupedModels = useMemo(() => buildGroupsForKind(kindFilter), [buildGroupsForKind, kindFilter]);

  // Media provider sections (Embedding, Text-to-Image, TTS, STT, Image-to-Text, Web Search, Web Fetch, ...).
  // Only built for the general-purpose picker (no explicit kindFilter) when the caller opts in,
  // so callers like the combo/media-provider pickers (which already pass a specific kindFilter) are unaffected.
  const mediaGroupsByKind = useMemo(() => {
    if (!includeMediaKinds || kindFilter) return {};
    const result = {};
    MEDIA_PROVIDER_KINDS.forEach((kindDef) => {
      const groups = buildGroupsForKind(kindDef.id);
      if (Object.keys(groups).length > 0) result[kindDef.id] = groups;
    });
    return result;
  }, [includeMediaKinds, kindFilter, buildGroupsForKind]);

  // Filter combos by search query (and hide combos when kindFilter is set — combos are LLM-only by design)
  const filteredCombos = useMemo(() => {
    if (kindFilter || capFilter) return [];
    if (!searchQuery.trim()) return combos;
    const query = searchQuery.toLowerCase();
    return combos.filter(c => c.name.toLowerCase().includes(query));
  }, [combos, searchQuery, kindFilter]);

  // Sort models alphabetically, with added models floated to top
  const sortModels = useCallback((models) => {
    const added = models.filter(m => addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    const rest = models.filter(m => !addedModelValues.includes(m.value)).sort((a, b) => a.name.localeCompare(b.name));
    return [...added, ...rest];
  }, [addedModelValues]);

  // Apply search query (and optional capability filter) to a provider->group map
  const applySearchFilter = useCallback((groups, { applyCap = true } = {}) => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = {};
    Object.entries(groups).forEach(([providerId, group]) => {
      let models = group.models;
      // Filter by input-modality capability (vision/pdf/audioInput/videoInput).
      if (applyCap && capFilter) {
        models = models.filter((m) => getCaps(m.value)?.[capFilter] === true);
        if (models.length === 0) return;
      }
      if (query) {
        const providerNameMatches = group.name.toLowerCase().includes(query);
        models = models.filter(
          (m) =>
            m.name.toLowerCase().includes(query) ||
            m.id.toLowerCase().includes(query)
        );
        if (models.length === 0 && !providerNameMatches) return;
      }
      filtered[providerId] = {
        ...group,
        models: sortModels(models),
      };
    });
    return filtered;
  }, [searchQuery, capFilter, getCaps, sortModels]);

  // Filter models by search query
  const filteredGroups = useMemo(() => applySearchFilter(groupedModels), [applySearchFilter, groupedModels]);

  const filteredMediaGroupsByKind = useMemo(() => {
    if (Object.keys(mediaGroupsByKind).length === 0) return {};
    const result = {};
    Object.entries(mediaGroupsByKind).forEach(([kindId, groups]) => {
      // Capability filter (vision/pdf/etc.) does not apply to non-LLM media kinds.
      const filtered = applySearchFilter(groups, { applyCap: false });
      if (Object.keys(filtered).length > 0) result[kindId] = filtered;
    });
    return result;
  }, [mediaGroupsByKind, applySearchFilter]);

  const handleSelect = (model) => {
    const value = model?.value || model?.name || model;
    const isAdded = addedModelValues.includes(value);

    if (isAdded && onDeselect) {
      onDeselect(model);
    } else {
      onSelect(model);
    }

    if (closeOnSelect) {
      onClose();
      setSearchQuery("");
    }
  };

  // Shared model button markup, reused for both the main section and the media-kind sections
  const renderModelButtons = (models) => models.map((model) => {
    const isSelected = selectedModel === model.value;
    const isPlaceholder = model.isPlaceholder;
    return (
      <button
        key={model.value}
        onClick={() => handleSelect(model)}
        title={isPlaceholder ? "Select to pre-fill, then edit model ID in the input" : undefined}
        className={`
          px-2 py-1 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer
          ${isPlaceholder
            ? "border-dashed border-border text-text-muted hover:border-primary/50 hover:text-primary bg-surface italic"
            : isSelected
              ? "bg-primary text-white border-primary"
              : addedModelValues.includes(model.value)
                ? "bg-primary border-primary text-white hover:bg-primary-hover"
                : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
          }
        `}
      >
        <span className="flex items-center gap-1">
          {addedModelValues.includes(model.value) && !isPlaceholder && (
            <span className="material-symbols-outlined leading-none" style={{ fontSize: "10px" }}>check</span>
          )}
          {isPlaceholder ? (
            <>
              <span className="material-symbols-outlined text-[11px]">edit</span>
              {model.name}
            </>
          ) : model.isCustom ? (
            <>
              {model.name}
              <span className="text-[9px] opacity-60 font-normal">custom</span>
              <CapacityBadges caps={getCaps(model.value)} />
            </>
          ) : (
            <>
              {model.name}
              <CapacityBadges caps={getCaps(model.value)} />
            </>
          )}
        </span>
      </button>
    );
  });

  const hasMediaResults = Object.keys(filteredMediaGroupsByKind).length > 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose();
        setSearchQuery("");
      }}
      title={title}
      size="md"
      className="p-4!"
      footer={null}
    >
      {/* Info bar */}
      <div className="flex items-center gap-2 mb-3 px-2.5 py-2 bg-primary/8 border border-primary/20 rounded-lg text-xs text-text-muted">
        <span className="material-symbols-outlined text-primary shrink-0" style={{ fontSize: "14px" }}>info</span>
        <span>Click to add, click again to remove. Changes are saved automatically.</span>
      </div>

      {/* Search - compact */}
      <div className="mb-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[16px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-surface border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Models grouped by provider - compact */}
      <div className="max-h-[400px] overflow-y-auto space-y-3">
        {/* Combos section - always first */}
        {filteredCombos.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5 sticky top-0 bg-surface py-0.5">
              <span className="material-symbols-outlined text-primary text-[14px]">layers</span>
              <span className="text-xs font-medium text-primary">Combos</span>
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
                      px-2 py-1 rounded-xl text-xs font-medium transition-all border hover:cursor-pointer flex items-center gap-1
                      ${isSelected
                        ? "bg-primary text-white border-primary"
                        : addedModelValues.includes(combo.name)
                          ? "bg-primary border-primary text-white hover:bg-primary-hover"
                          : "bg-surface border-border text-text-main hover:border-primary/50 hover:bg-primary/5"
                      }
                    `}
                  >
                    {addedModelValues.includes(combo.name) && (
                      <span className="material-symbols-outlined leading-none" style={{ fontSize: "10px" }}>check</span>
                    )}
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
              <ProviderIcon
                src={`/providers/${providerId}.png`}
                alt={group.name}
                size={14}
                fallbackText={(group.name || providerId).slice(0, 2).toUpperCase()}
                fallbackColor={group.color}
              />
              <span className="text-xs font-medium text-primary">
                {group.name}
              </span>
              <span className="text-[10px] text-text-muted">
                ({group.models.length})
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {renderModelButtons(group.models)}
            </div>
          </div>
        ))}

        {/* Media provider sections (Embedding, TTS, STT, Image, Image-to-Text, Web Search, Web Fetch, ...) */}
        {hasMediaResults && Object.entries(filteredMediaGroupsByKind).map(([kindId, groups]) => {
          const kindDef = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
          return (
            <div key={kindId} className="pt-2 border-t border-border/60">
              <div className="flex items-center gap-1.5 mb-2 sticky top-0 bg-surface py-0.5">
                <span className="material-symbols-outlined text-text-muted text-[14px]">
                  {kindDef?.icon || "extension"}
                </span>
                <span className="text-xs font-medium text-text-muted">
                  {kindDef?.label || kindId}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {Object.entries(groups).map(([providerId, group]) => (
                  <div key={`${kindId}-${providerId}`}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <ProviderIcon
                        src={`/providers/${providerId}.png`}
                        alt={group.name}
                        size={14}
                        fallbackText={(group.name || providerId).slice(0, 2).toUpperCase()}
                        fallbackColor={group.color}
                      />
                      <span className="text-xs font-medium text-primary">
                        {group.name}
                      </span>
                      <span className="text-[10px] text-text-muted">
                        ({group.models.length})
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {renderModelButtons(group.models)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {Object.keys(filteredGroups).length === 0 && filteredCombos.length === 0 && !hasMediaResults && (
          <div className="text-center py-4 text-text-muted">
            <span className="material-symbols-outlined text-2xl mb-1 block">
              search_off
            </span>
            <p className="text-xs">No models found</p>
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
  onDeselect: PropTypes.func,
  selectedModel: PropTypes.string,
  activeProviders: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string.isRequired,
    })
  ),
  title: PropTypes.string,
  modelAliases: PropTypes.object,
  kindFilter: PropTypes.string,
  capFilter: PropTypes.string,
  addedModelValues: PropTypes.arrayOf(PropTypes.string),
  closeOnSelect: PropTypes.bool,
  includeMediaKinds: PropTypes.bool,
};
