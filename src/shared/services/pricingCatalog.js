import { getCustomModels, getPricingMappings, getPricingModels, getProviderConnections, getProviderNodes, getSettings } from "@/lib/localDb";
import { getModelsByProviderId } from "open-sse/config/providerModels.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { FREE_PROVIDERS } from "@/shared/constants/providers.js";

const RATE_FIELDS = ["input", "output", "cached", "cache_creation", "reasoning"];
export const EMPTY_PRICING = Object.fromEntries(RATE_FIELDS.map((field) => [field, 0]));

function providerMetadata() {
  const names = new Map();
  const providerIds = new Map();
  for (const provider of REGISTRY) {
    const name = provider.display?.name || provider.name || provider.id;
    for (const key of [provider.id, provider.alias, ...(provider.aliases || [])].filter(Boolean)) {
      names.set(key, name);
      providerIds.set(key, provider.id);
    }
  }
  return { names, providerIds };
}

function normalizeModelId(value, prefixes) {
  const model = String(value || "").trim();
  for (const prefix of prefixes.filter(Boolean)) {
    if (model.startsWith(`${prefix}/`)) return model.slice(prefix.length + 1);
  }
  return model;
}

export async function getProviderPricingCatalog() {
  const [connections, nodes, customModels, settings] = await Promise.all([
    getProviderConnections(),
    getProviderNodes(),
    getCustomModels(),
    getSettings(),
  ]);
  const { names, providerIds } = providerMetadata();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    providerIds.set(node.id, node.id);
    if (node.prefix) providerIds.set(node.prefix, node.id);
  }
  const smartRoutingProviders = new Set(
    Object.entries(settings.smartRoutingProviders || {})
      .filter(([, config]) => config?.enabled === true)
      .map(([provider]) => providerIds.get(provider) || provider),
  );
  const availableProviders = new Set(
    connections
      .filter((connection) => connection.isActive !== false || connection.autoDisabled === true || !!connection.autoDisabledReason)
      .map((connection) => providerIds.get(connection.provider) || connection.provider)
      .filter((provider) => !smartRoutingProviders.has(provider)),
  );
  for (const provider of Object.values(FREE_PROVIDERS)) {
    if (provider.noAuth && !smartRoutingProviders.has(provider.id)) availableProviders.add(provider.id);
  }
  const catalog = new Map();
  const add = (provider, model) => {
    const cleanProvider = String(providerIds.get(provider) || provider || "").trim();
    const cleanModel = String(model || "").trim();
    if (!cleanProvider || !cleanModel || !availableProviders.has(cleanProvider) || smartRoutingProviders.has(cleanProvider)) return;
    const id = `${cleanProvider}\u0000${cleanModel}`;
    if (!catalog.has(id)) catalog.set(id, {
      id,
      provider: cleanProvider,
      providerName: settings.providerDisplayNames?.[cleanProvider] || nodeById.get(cleanProvider)?.name || names.get(cleanProvider) || cleanProvider,
      model: cleanModel,
    });
  };

  for (const provider of availableProviders) {
    for (const model of getModelsByProviderId(provider) || []) add(provider, typeof model === "string" ? model : model?.id);
  }
  for (const connection of connections) {
    const provider = providerIds.get(connection.provider) || connection.provider;
    if (!availableProviders.has(provider)) continue;
    const node = nodeById.get(provider);
    const prefixes = [provider, connection.provider, node?.prefix];
    for (const model of connection.providerSpecificData?.enabledModels || []) {
      const modelId = typeof model === "string" ? model : model?.id || model?.model || model?.name;
      add(provider, normalizeModelId(modelId, prefixes));
    }
  }
  for (const model of customModels) {
    const provider = providerIds.get(model.providerAlias) || model.providerAlias;
    add(provider, normalizeModelId(model.id, [provider, model.providerAlias, nodeById.get(provider)?.prefix]));
  }

  return [...catalog.values()].sort((a, b) =>
    a.providerName.localeCompare(b.providerName) || a.model.localeCompare(b.model),
  );
}

export async function getPricingPageData() {
  const [pricingModels, mappings, settings, providerModels] = await Promise.all([
    getPricingModels(),
    getPricingMappings(),
    getSettings(),
    getProviderPricingCatalog(),
  ]);
  const mappingMap = new Map(mappings.map((item) => [`${item.provider}\u0000${item.model}`, item.pricingModel]));
  const visibleProviderModelIds = new Set(providerModels.map((item) => item.id));
  const counts = new Map();
  for (const mapping of mappings) {
    if (!visibleProviderModelIds.has(`${mapping.provider}\u0000${mapping.model}`)) continue;
    counts.set(mapping.pricingModel, (counts.get(mapping.pricingModel) || 0) + 1);
  }
  const normalizedIds = new Map(Object.keys(pricingModels).map((model) => [model.toLowerCase(), model]));

  const priced = Object.entries(pricingModels).map(([model, pricing]) => ({
    model,
    pricing: { ...EMPTY_PRICING, ...pricing },
    mappedCount: counts.get(model) || 0,
    isDefault: settings.defaultPricingModel === model,
  })).sort((a, b) => a.model.localeCompare(b.model));

  const catalog = providerModels.map((item) => {
    const mappedPricingModel = mappingMap.get(item.id) || "";
    return {
      ...item,
      mappedPricingModel,
      effectivePricingModel: mappedPricingModel || settings.defaultPricingModel || "",
      usesDefault: !mappedPricingModel && !!settings.defaultPricingModel,
      recommendedPricingModel: normalizedIds.get(item.model.toLowerCase()) || "",
    };
  });

  return {
    priced,
    providerModels: catalog,
    unpriced: catalog.filter((item) => !item.mappedPricingModel),
    defaultPricingModel: settings.defaultPricingModel || "",
  };
}
