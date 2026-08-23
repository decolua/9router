import { getCustomModels, getProviderConnections, getProviderNodes } from "@/lib/localDb";
import { AI_MODELS } from "@/shared/constants/models.js";
import { AI_PROVIDERS, FREE_PROVIDERS, getProviderAlias, resolveProviderId } from "@/shared/constants/providers.js";

function normalizeUpstreamModel(value, prefixes) {
  const model = String(value || "").trim();
  for (const prefix of prefixes.filter(Boolean)) {
    if (model.startsWith(`${prefix}/`)) return model.slice(prefix.length + 1);
  }
  return model;
}

export async function getModelMappingCatalog() {
  const [connections, nodes, customModels] = await Promise.all([
    getProviderConnections(),
    getProviderNodes(),
    getCustomModels(),
  ]);
  const activeConnections = connections.filter((connection) => connection.isActive !== false);
  const activeProviders = new Set(activeConnections.map((connection) => connection.provider));
  for (const provider of Object.values(FREE_PROVIDERS)) {
    if (provider.noAuth) activeProviders.add(provider.id);
  }
  const includeAll = activeProviders.size === 0;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const providerByPrefix = new Map();
  for (const provider of Object.values(AI_PROVIDERS)) {
    providerByPrefix.set(provider.id, provider.id);
    if (provider.alias) providerByPrefix.set(provider.alias, provider.id);
  }
  for (const node of nodes) {
    providerByPrefix.set(node.id, node.id);
    if (node.prefix) providerByPrefix.set(node.prefix, node.id);
  }
  const routePrefixByProvider = new Map(activeConnections.map((connection) => [
    connection.provider,
    connection.providerSpecificData?.prefix || nodeById.get(connection.provider)?.prefix || getProviderAlias(connection.provider) || connection.provider,
  ]));
  const catalog = new Map();
  const add = (provider, upstreamModel) => {
    const cleanProvider = String(provider || "").trim();
    const cleanModel = String(upstreamModel || "").trim();
    if (!cleanProvider || !cleanModel || (!includeAll && !activeProviders.has(cleanProvider))) return;
    const id = `${cleanProvider}\u0000${cleanModel}`;
    if (catalog.has(id)) return;
    const routePrefix = routePrefixByProvider.get(cleanProvider) || nodeById.get(cleanProvider)?.prefix || getProviderAlias(cleanProvider) || cleanProvider;
    catalog.set(id, {
      id,
      provider: cleanProvider,
      providerName: nodeById.get(cleanProvider)?.name || AI_PROVIDERS[cleanProvider]?.name || cleanProvider,
      upstreamModel: cleanModel,
      routeModel: `${routePrefix}/${cleanModel}`,
    });
  };

  for (const model of AI_MODELS) add(resolveProviderId(model.provider), model.model);

  for (const connection of activeConnections) {
    const provider = connection.provider;
    const routePrefix = routePrefixByProvider.get(provider);
    const prefixes = [provider, getProviderAlias(provider), routePrefix, nodeById.get(provider)?.prefix];
    for (const model of connection.providerSpecificData?.enabledModels || []) {
      add(provider, normalizeUpstreamModel(model, prefixes));
    }
  }

  for (const model of customModels) {
    const provider = providerByPrefix.get(model.providerAlias) || resolveProviderId(model.providerAlias);
    add(provider, normalizeUpstreamModel(model.id, [provider, model.providerAlias, getProviderAlias(provider)]));
  }

  return [...catalog.values()].sort((a, b) => a.providerName.localeCompare(b.providerName) || a.upstreamModel.localeCompare(b.upstreamModel));
}
