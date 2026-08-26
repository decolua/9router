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
    if (!connection || connection.isActive === false || containsForbiddenConnectionField(connection)) continue;
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
  const res = await fetch("/api/providers");
  if (!res.ok) throw new Error(`Failed to fetch providers: ${res.status}`);
  const providers = await res.json();
  const connections = Array.isArray(providers) ? providers : providers.data || [];
  
  // Basic mock integration until Todo 3/4 completes live capability discovery
  const mockPayload = {
    connections,
    staticModelsByProvider: {},
    liveModelsByConnection: Object.fromEntries(
      connections.map(c => [
        c.id, 
        c.models?.map(m => typeof m === "string" ? { id: m } : m) || []
      ])
    )
  };
  
  return { models: normalizeModelCatalog(mockPayload) };
}
