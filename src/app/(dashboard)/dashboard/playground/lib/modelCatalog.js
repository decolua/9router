const CONNECTION_FORBIDDEN_FIELDS = new Set([
  "apiKey",
  "accessToken",
  "refreshToken",
  "idToken",
  "providerSpecificData",
  "headers",
  "url",
  "baseUrl",
  "cookie",
  "cookies",
]);

const CAPABILITY_FIELDS = new Set([
  "temperature",
  "topP",
  "maxTokens",
  "presencePenalty",
  "frequencyPenalty",
  "seed",
  "stop",
  "reasoning",
  "images",
  "vision",
  "search",
  "tools",
  "contextWindow",
  "maxOutput",
]);

function nonEmptyString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function containsForbiddenConnectionField(connection) {
  return Object.keys(connection).some((key) => CONNECTION_FORBIDDEN_FIELDS.has(key));
}

function normalizeCapabilities(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, capability]) => (
      CAPABILITY_FIELDS.has(key) && (typeof capability === "boolean" || typeof capability === "number" || typeof capability === "string")
    ))
  );
}

function modelIdentity(providerId, modelId) {
  return modelId.includes("/") ? modelId : `${providerId}/${modelId}`;
}

function normalizeModel(rawModel, connection, source) {
  const rawId = typeof rawModel === "string"
    ? rawModel
    : rawModel?.id || rawModel?.model || rawModel?.name;
  const modelId = nonEmptyString(rawId);
  if (!modelId) return null;

  const label = typeof rawModel === "string"
    ? rawModel
    : nonEmptyString(rawModel.name) || nonEmptyString(rawModel.displayName) || modelId;
  return {
    id: modelIdentity(connection.provider, modelId),
    label,
    provider: {
      id: connection.provider,
      name: connection.name,
      connectionId: connection.id,
    },
    available: rawModel?.available !== false,
    capabilities: normalizeCapabilities(rawModel?.capabilities),
    source,
  };
}

function mergeModel(existing, incoming) {
  return {
    ...existing,
    label: existing.source === "static" ? existing.label : incoming.label,
    available: existing.available && incoming.available,
    capabilities: { ...existing.capabilities, ...incoming.capabilities },
  };
}

export function normalizeModelCatalog({ connections, staticModelsByProvider, liveModelsByConnection } = {}) {
  const catalog = new Map();
  const activeConnections = Array.isArray(connections) ? connections : [];

  for (const connection of activeConnections) {
    if (!connection || connection.isActive === false) continue;
    const providerId = nonEmptyString(connection.provider);
    const connectionId = nonEmptyString(connection.id);
    const providerName = nonEmptyString(connection.name) || providerId;
    if (!providerId || !connectionId) continue;

    const safeConnection = { provider: providerId, id: connectionId, name: providerName };
    const staticModels = Array.isArray(staticModelsByProvider?.[providerId]) ? staticModelsByProvider[providerId] : [];
    const liveModels = Array.isArray(liveModelsByConnection?.[connectionId]) ? liveModelsByConnection[connectionId] : [];

    for (const [source, models] of [["static", staticModels], ["live", liveModels]]) {
      for (const rawModel of models) {
        const model = normalizeModel(rawModel, safeConnection, source);
        if (!model) continue;
        const existing = catalog.get(model.id);
        catalog.set(model.id, existing ? mergeModel(existing, model) : model);
      }
    }
  }

  return Array.from(catalog.values())
    .map(({ source, ...model }) => model)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export async function fetchModelCatalog() {
  const res = await fetch("/api/providers", { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load connections (status: ${res.status})`);

  let providers;
  try {
    providers = await res.json();
  } catch {
    throw new Error("Failed to parse connections payload");
  }

  const connections = Array.isArray(providers?.connections) ? providers.connections : [];
  const activeConnections = connections.filter((connection) => (
    connection?.isActive !== false && nonEmptyString(connection?.id)
  ));
  const liveResults = await Promise.all(activeConnections.map(async (connection) => {
    try {
      const response = await fetch(`/api/providers/${connection.id}/models`, { cache: "no-store" });
      if (!response.ok) return [connection.id, []];
      const payload = await response.json();
      return [connection.id, Array.isArray(payload?.models) ? payload.models : []];
    } catch {
      return [connection.id, []];
    }
  }));

  return {
    models: normalizeModelCatalog({
      connections,
      staticModelsByProvider: {},
      liveModelsByConnection: Object.fromEntries(liveResults),
    }),
  };
}
