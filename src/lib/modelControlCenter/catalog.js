import REGISTRY from "open-sse/providers/registry/index.js";
import {
  getModelsByProviderId,
  PROVIDER_ID_TO_ALIAS,
} from "open-sse/config/providerModels.js";
import {
  getProviderConnections,
  getCustomModels,
} from "@/models";
import {
  readControlCenter,
  writeControlCenter,
} from "./store.js";

function normalizeKind(model = {}) {
  if (model.kind) return model.kind;
  if (model.type) return model.type;
  if (Array.isArray(model.kinds) && model.kinds.length) return model.kinds[0];
  return "llm";
}

function normalizeModel(raw = {}) {
  const id = String(raw.id || raw.model || raw.name || "").trim();
  if (!id) return null;
  return {
    id,
    name: String(raw.name || raw.displayName || id),
    kind: normalizeKind(raw),
  };
}

function modelSignature(model) {
  return JSON.stringify([
    model.id,
    model.name,
    model.kind,
    model.configured,
    model.discovered,
    model.custom,
    model.source,
    model.connectionsAvailable,
    model.connectionsQueried,
    model.stale,
  ]);
}

function addModel(map, raw, flags = {}, connectionId = null) {
  const normalized = normalizeModel(raw);
  if (!normalized) return;

  const current = map[normalized.id] || {
    ...normalized,
    configured: false,
    discovered: false,
    custom: false,
    stale: false,
    _sources: new Set(),
    _connections: new Set(),
  };

  current.name = normalized.name || current.name;
  current.kind = normalized.kind || current.kind;
  if (flags.configured) current.configured = true;
  if (flags.discovered) current.discovered = true;
  if (flags.custom) current.custom = true;
  if (flags.source) current._sources.add(flags.source);
  if (connectionId) current._connections.add(connectionId);

  map[normalized.id] = current;
}

function sourceLabel(sources) {
  const values = [...sources];
  if (values.length > 1) return "mixed";
  return values[0] || "static";
}

export async function rebuildControlCenter(discovery = []) {
  const previous = readControlCenter();
  const connections = await getProviderConnections({ isActive: true });
  const customModels = await getCustomModels().catch(() => []);

  const byProvider = new Map();
  for (const connection of connections) {
    const list = byProvider.get(connection.provider) || [];
    list.push(connection);
    byProvider.set(connection.provider, list);
  }

  const discoveryByProvider = new Map();
  for (const item of discovery) {
    if (!item?.provider || !item?.connectionId) continue;
    const list = discoveryByProvider.get(item.provider) || [];
    list.push(item);
    discoveryByProvider.set(item.provider, list);
  }

  const registryMap = new Map(REGISTRY.map((entry) => [entry.id, entry]));
  const providers = {};

  for (const [providerId, providerConnections] of byProvider.entries()) {
    const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
    const registryEntry = registryMap.get(providerId);
    const providerDiscovery = discoveryByProvider.get(providerId) || [];
    const modelMap = {};

    for (const model of getModelsByProviderId(providerId)) {
      addModel(modelMap, model, { configured: true, source: "static" });
    }

    for (const model of customModels.filter((item) => item.providerAlias === alias)) {
      addModel(modelMap, model, { custom: true, source: "custom" });
    }

    for (const item of providerDiscovery) {
      for (const model of item.models || []) {
        addModel(
          modelMap,
          model,
          { discovered: true, source: "resolved" },
          item.connectionId,
        );
      }
    }

    const previousProvider = previous.providers?.[providerId];
    const currentModels = {};

    for (const entry of Object.values(modelMap)) {
      const sources = entry._sources;
      const connectionSet = entry._connections;
      const model = {
        id: entry.id,
        name: entry.name,
        kind: entry.kind || "llm",
        fullModel: `${alias}/${entry.id}`,
        configured: entry.configured === true,
        discovered: entry.discovered === true,
        custom: entry.custom === true,
        stale: false,
        source: sourceLabel(sources),
        connectionsAvailable: connectionSet.size,
        connectionsQueried: providerDiscovery.length,
        connectionCount: providerConnections.length,
        availabilityKnown: providerDiscovery.length > 0,
      };

      const old = previousProvider?.models?.[model.id];
      model.health = old?.health || null;
      model.changed = !old || modelSignature(old) !== modelSignature(model);
      currentModels[model.id] = model;
    }

    for (const [modelId, old] of Object.entries(previousProvider?.models || {})) {
      if (currentModels[modelId]) continue;
      currentModels[modelId] = {
        ...old,
        stale: true,
        changed: true,
        connectionsAvailable: 0,
        connectionsQueried: providerDiscovery.length,
        connectionCount: providerConnections.length,
      };
    }

    providers[providerId] = {
      providerId,
      alias,
      name: registryEntry?.display?.name || providerId,
      connectionCount: providerConnections.length,
      connectionsQueried: providerDiscovery.length,
      connections: providerConnections.map((connection) => ({
        id: connection.id,
        name: connection.name || connection.email || `Connection ${connection.priority || ""}`.trim(),
        authType: connection.authType,
        priority: connection.priority,
      })),
      warning: providerDiscovery
        .map((item) => item.warning)
        .filter(Boolean)
        .join(" | ") || null,
      models: currentModels,
    };
  }

  const next = {
    ...previous,
    v: 1,
    syncedAt: new Date().toISOString(),
    providers,
  };

  return writeControlCenter(next);
}
