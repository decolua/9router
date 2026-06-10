import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import {
  AI_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";

// Capability entries extend the OpenAI-style model list with routing metadata:
// - kind: primary service bucket used for filtering and auto-routing.
// - capabilities: endpoint and feature hints exposed to downstream clients.
// - availability: whether at least one configured connection can serve the model.
const LLM_KIND = "llm";

const MODEL_TYPE_TO_KIND = {
  image: "image",
  video: "video",
  tts: "tts",
  embedding: "embedding",
  stt: "stt",
  imageToText: "imageToText",
};

export const CAPABILITY_ENDPOINTS = {
  llm: "/v1/chat/completions",
  image: "/v1/images/generations",
  video: "/v1/video/generations",
  tts: "/v1/audio/speech",
  stt: "/v1/audio/transcriptions",
  embedding: "/v1/embeddings",
  imageToText: "/v1/chat/completions",
  webSearch: "/v1/search",
  webFetch: "/v1/web/fetch",
};

export const PUBLIC_CAPABILITY_KINDS = [
  "llm",
  "image",
  "video",
  "tts",
  "stt",
  "embedding",
  "imageToText",
  "webSearch",
  "webFetch",
];

export function getModelKind(model) {
  if (!model?.type) return LLM_KIND;
  return MODEL_TYPE_TO_KIND[model.type] || LLM_KIND;
}

export function inferKindFromModelId(modelId) {
  const lower = String(modelId || "").toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/video|veo|runway|gen-?[34]|kling|wan-|hailuo|luma|seedance/.test(lower)) return "video";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/.test(lower)) return "image";
  return LLM_KIND;
}

export function providerMatchesKinds(providerId, kindFilter) {
  const provider = AI_PROVIDERS[providerId];
  const kinds = Array.isArray(provider?.serviceKinds) && provider.serviceKinds.length > 0
    ? provider.serviceKinds
    : [LLM_KIND];
  return kindFilter.some((k) => kinds.includes(k));
}

export function comboMatchesKinds(combo, kindFilter) {
  const kind = combo?.kind || LLM_KIND;
  return kindFilter.includes(kind);
}

export function getConnectionAliases(providerId, connection = {}) {
  const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  const outputAlias = (
    connection?.providerSpecificData?.prefix
    || getProviderAlias(providerId)
    || staticAlias
  ).trim();
  return { staticAlias, outputAlias };
}

export function normalizeModelId(modelId, aliases) {
  if (typeof modelId !== "string") return "";
  const trimmed = modelId.trim();
  if (!trimmed) return "";
  for (const alias of [aliases.outputAlias, aliases.staticAlias, aliases.providerId]) {
    if (alias && trimmed.startsWith(`${alias}/`)) return trimmed.slice(alias.length + 1);
  }
  return trimmed;
}

function isDisabledModel(disabledByAlias, aliases, modelId) {
  return [aliases.outputAlias, aliases.staticAlias, aliases.providerId].some(
    (alias) => Array.isArray(disabledByAlias?.[alias]) && disabledByAlias[alias].includes(modelId),
  );
}

function getStaticModelMap(staticAlias) {
  return new Map((PROVIDER_MODELS[staticAlias] || []).map((model) => [model.id, model]));
}

function appendModel(registry, entry) {
  if (!entry?.id || registry.seen.has(entry.id)) return;
  registry.seen.add(entry.id);
  registry.models.push(entry);
}

function buildAvailability(connection, statusOverride) {
  if (statusOverride) return { status: statusOverride };
  if (!connection) return { status: "configured" };
  if (connection.testStatus === "unavailable") {
    return {
      status: "unavailable",
      lastError: connection.lastError || null,
      lastErrorAt: connection.lastErrorAt || null,
    };
  }
  return {
    status: connection.testStatus === "active" ? "available" : "untested",
    testStatus: connection.testStatus || null,
  };
}

export function buildCapabilityRegistry({
  connections = [],
  combos = [],
  customModels = [],
  modelAliases = {},
  disabledByAlias = {},
  includeInactive = false,
} = {}) {
  const activeConnections = connections.filter((connection) => includeInactive || connection.isActive !== false);
  const activeConnectionByProvider = new Map();
  for (const connection of activeConnections) {
    if (!activeConnectionByProvider.has(connection.provider)) {
      activeConnectionByProvider.set(connection.provider, connection);
    }
  }

  const registry = { models: [], seen: new Set() };

  for (const combo of combos) {
    const kind = combo?.kind || LLM_KIND;
    appendModel(registry, {
      id: combo.name,
      object: "model",
      name: combo.name,
      kind,
      owned_by: "combo",
      provider: "combo",
      endpoint: CAPABILITY_ENDPOINTS[kind] || CAPABILITY_ENDPOINTS.llm,
      source: "combo",
      availability: { status: "configured" },
    });
  }

  for (const [providerId, connection] of activeConnectionByProvider.entries()) {
    const providerInfo = AI_PROVIDERS[providerId] || {};
    const aliases = { providerId, ...getConnectionAliases(providerId, connection) };
    const staticModels = PROVIDER_MODELS[aliases.staticAlias] || [];
    const staticById = getStaticModelMap(aliases.staticAlias);
    const enabledModels = Array.isArray(connection?.providerSpecificData?.enabledModels)
      ? connection.providerSpecificData.enabledModels
      : [];
    const rawModelIds = enabledModels.length > 0
      ? enabledModels
      : staticModels.map((model) => model.id);

    const customModelIds = customModels
      .filter((model) => {
        if (!model?.id) return false;
        const alias = model.providerAlias;
        return alias === aliases.staticAlias || alias === aliases.outputAlias || alias === providerId;
      })
      .map((model) => model.id);

    const aliasModelIds = Object.values(modelAliases || {})
      .filter((fullModel) => typeof fullModel === "string" && fullModel.includes("/"))
      .filter((fullModel) => (
        fullModel.startsWith(`${aliases.outputAlias}/`)
        || fullModel.startsWith(`${aliases.staticAlias}/`)
        || fullModel.startsWith(`${providerId}/`)
      ));

    const mergedModelIds = Array.from(new Set([...rawModelIds, ...customModelIds, ...aliasModelIds]))
      .map((modelId) => normalizeModelId(modelId, aliases))
      .filter(Boolean);

    for (const modelId of mergedModelIds) {
      if (isDisabledModel(disabledByAlias, aliases, modelId)) continue;
      const staticModel = staticById.get(modelId);
      const kind = staticModel ? getModelKind(staticModel) : inferKindFromModelId(modelId);
      appendModel(registry, {
        id: `${aliases.outputAlias}/${modelId}`,
        object: "model",
        name: staticModel?.name || modelId,
        kind,
        owned_by: aliases.outputAlias,
        provider: providerId,
        providerName: providerInfo.name || providerId,
        connectionId: connection.id,
        connectionName: connection.name || connection.email || connection.id,
        priority: connection.priority || 999,
        endpoint: CAPABILITY_ENDPOINTS[kind] || CAPABILITY_ENDPOINTS.llm,
        source: staticModel ? "static" : "custom",
        params: staticModel?.params || undefined,
        capabilities: staticModel?.capabilities || undefined,
        availability: buildAvailability(connection),
      });
    }

    const subConfigs = [
      ["tts", providerInfo.ttsConfig],
      ["stt", providerInfo.sttConfig],
      ["embedding", providerInfo.embeddingConfig],
    ];
    for (const [kind, config] of subConfigs) {
      for (const model of config?.models || []) {
        if (!model?.id || isDisabledModel(disabledByAlias, aliases, model.id)) continue;
        appendModel(registry, {
          id: `${aliases.outputAlias}/${model.id}`,
          object: "model",
          name: model.name || model.id,
          kind,
          owned_by: aliases.outputAlias,
          provider: providerId,
          providerName: providerInfo.name || providerId,
          connectionId: connection.id,
          priority: connection.priority || 999,
          endpoint: CAPABILITY_ENDPOINTS[kind],
          source: "provider-config",
          dimensions: model.dimensions || undefined,
          availability: buildAvailability(connection),
        });
      }
    }

    if (providerInfo.searchConfig) {
      appendModel(registry, {
        id: `${aliases.outputAlias}/search`,
        object: "model",
        name: `${providerInfo.name || providerId} Search`,
        kind: "webSearch",
        owned_by: aliases.outputAlias,
        provider: providerId,
        providerName: providerInfo.name || providerId,
        connectionId: connection.id,
        priority: connection.priority || 999,
        endpoint: CAPABILITY_ENDPOINTS.webSearch,
        source: "virtual",
        availability: buildAvailability(connection),
      });
    }
    if (providerInfo.fetchConfig) {
      appendModel(registry, {
        id: `${aliases.outputAlias}/fetch`,
        object: "model",
        name: `${providerInfo.name || providerId} Fetch`,
        kind: "webFetch",
        owned_by: aliases.outputAlias,
        provider: providerId,
        providerName: providerInfo.name || providerId,
        connectionId: connection.id,
        priority: connection.priority || 999,
        endpoint: CAPABILITY_ENDPOINTS.webFetch,
        source: "virtual",
        availability: buildAvailability(connection),
      });
    }

    if ((isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId)) && mergedModelIds.length === 0) {
      appendModel(registry, {
        id: aliases.outputAlias,
        object: "model",
        name: providerInfo.name || aliases.outputAlias,
        kind: LLM_KIND,
        owned_by: aliases.outputAlias,
        provider: providerId,
        providerName: providerInfo.name || providerId,
        connectionId: connection.id,
        priority: connection.priority || 999,
        endpoint: CAPABILITY_ENDPOINTS.llm,
        source: "passthrough",
        availability: buildAvailability(connection, "discoverable"),
      });
    }
  }

  registry.models.sort((a, b) => {
    const kindCompare = PUBLIC_CAPABILITY_KINDS.indexOf(a.kind) - PUBLIC_CAPABILITY_KINDS.indexOf(b.kind);
    if (kindCompare !== 0) return kindCompare;
    return a.id.localeCompare(b.id);
  });

  return registry.models;
}

export function summarizeCapabilities(models) {
  const byKind = {};
  for (const kind of PUBLIC_CAPABILITY_KINDS) {
    const kindModels = models.filter((model) => model.kind === kind);
    byKind[kind] = {
      count: kindModels.length,
      availableCount: kindModels.filter((model) => model.availability?.status === "available").length,
      endpoint: CAPABILITY_ENDPOINTS[kind] || null,
    };
  }
  return byKind;
}
