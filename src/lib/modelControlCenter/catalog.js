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
import { getModelDiscoveryGuard } from "@/shared/utils/modelDiscoveryGuard.js";

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

function isConnectionlessRegistryProvider(entry) {
  return (
    entry?.noAuth === true
    || entry?.transport?.noAuth === true
  );
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

  // Built-in no-auth providers are operational without a
  // providerConnections row. Include them in Control Center when
  // they expose at least one registry model.
  for (const registryEntry of REGISTRY) {
    if (
      !isConnectionlessRegistryProvider(
        registryEntry,
      )
    ) {
      continue;
    }

    if (
      getModelsByProviderId(
        registryEntry.id,
      ).length === 0
    ) {
      continue;
    }

    if (!byProvider.has(registryEntry.id)) {
      byProvider.set(
        registryEntry.id,
        [],
      );
    }
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
    const connectionless =
      isConnectionlessRegistryProvider(
        registryEntry,
      );
    const providerDiscovery = discoveryByProvider.get(providerId) || [];
    const modelMap = {};
    const detectedMap = {};
    const discoveryGuard = getModelDiscoveryGuard(providerId);

    for (const model of getModelsByProviderId(providerId)) {
      addModel(modelMap, model, { configured: true, source: "static" });
    }

    for (const model of customModels.filter((item) => item.providerAlias === alias)) {
      addModel(modelMap, model, { custom: true, source: "custom" });
    }

    const successfulDiscovery = providerDiscovery.filter(
      (item) =>
        !item.warning
        && (
          !discoveryGuard.customProvider
          || item.catalog === true
        ),
    );

    for (const item of providerDiscovery) {
      const isLiveDiscovery = !item.warning;
      const observeOnly =
        discoveryGuard.customProvider
        && item.catalog !== true;

      for (const model of item.models || []) {
        // Guarded custom providers default to observe-only. Their live model
        // listing is evidence, not automatic Control Center catalog authority.
        if (observeOnly) {
          if (isLiveDiscovery) {
            addModel(
              detectedMap,
              model,
              {
                discovered: true,
                source: "resolved",
              },
              item.connectionId,
            );
          }
          continue;
        }

        addModel(
          modelMap,
          model,
          {
            discovered: isLiveDiscovery,
            source: isLiveDiscovery ? "resolved" : "fallback",
          },
          isLiveDiscovery ? item.connectionId : null,
        );
      }
    }

    const previousProvider = previous.providers?.[providerId];

    const detectedModels = {};
    for (const entry of Object.values(detectedMap)) {
      detectedModels[entry.id] = {
        id: entry.id,
        name: entry.name,
        kind: entry.kind || "llm",
        fullModel: `${alias}/${entry.id}`,
        detected: true,
        cataloged: Boolean(modelMap[entry.id]),
        testable: false,
        routable: false,
        stale: false,
        source: sourceLabel(entry._sources),
        connectionsAvailable: entry._connections.size,
        connectionsQueried: providerDiscovery.length,
      };
    }

    // A later normal refresh deliberately performs no automatic discovery for
    // custom providers. Preserve the last explicit observe-only snapshot.
    if (
      discoveryGuard.customProvider
      && providerDiscovery.length === 0
    ) {
      for (
        const [modelId, old]
        of Object.entries(previousProvider?.detectedModels || {})
      ) {
        detectedModels[modelId] = {
          ...old,
          cataloged: Boolean(modelMap[modelId]),
          testable: false,
          routable: false,
        };
      }
    }

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
        cataloged: true,
        testable: discoveryGuard.customProvider ? false : null,
        routable: discoveryGuard.customProvider ? false : null,
        stale: false,
        source: sourceLabel(sources),
        connectionsAvailable: connectionSet.size,
        connectionsQueried: providerDiscovery.length,
        connectionCount: providerConnections.length,
        availabilityKnown: successfulDiscovery.length > 0,
      };

      const old = previousProvider?.models?.[model.id];
      model.health = old?.health || null;

      // A never-tested model must remain "changed" so Test Changed
      // can perform its first real health probe.
      model.changed =
        !old
        || !old.health
        || modelSignature(old) !== modelSignature(model);
      currentModels[model.id] = model;
    }

    for (const [modelId, old] of Object.entries(previousProvider?.models || {})) {
      if (currentModels[modelId]) continue;

      // Remove legacy auto-discovered custom models from catalog authority.
      // Preserve them only as detected/observe-only evidence.
      if (
        discoveryGuard.customProvider
        && old.discovered === true
        && old.configured !== true
        && old.custom !== true
      ) {
        if (!detectedModels[modelId]) {
          detectedModels[modelId] = {
            id: modelId,
            name: old.name || modelId,
            kind: old.kind || "llm",
            fullModel: old.fullModel || `${alias}/${modelId}`,
            detected: true,
            cataloged: false,
            testable: false,
            routable: false,
            stale: true,
            source: old.source || "resolved",
            connectionsAvailable: 0,
            connectionsQueried: 0,
          };
        }
        continue;
      }

      currentModels[modelId] = {
        ...old,
        cataloged: true,
        testable: discoveryGuard.customProvider ? false : null,
        routable: discoveryGuard.customProvider ? false : null,
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
      connectionless,
      connectionCount: providerConnections.length,
      connectionsQueried: providerDiscovery.length,
      connections: providerConnections.map((connection) => ({
        id: connection.id,
        name: connection.name || connection.email || `Connection ${connection.priority || ""}`.trim(),
        authType: connection.authType,
        priority: connection.priority,
      })),
      warning: [...new Set(
        providerDiscovery
          .map((item) => item.warning)
          .filter(Boolean),
      )].join(" | ") || null,
      discoveryGuard,
      detectedModels,
      detectedCount: Object.keys(detectedModels).length,
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
