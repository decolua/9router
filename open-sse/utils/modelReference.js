// Wire references remain strings; account identity is separate inside the router.
const CONNECTION_SUFFIX = /@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseModelReference(value) {
  if (typeof value !== "string") return { model: value, connectionId: null };
  const match = CONNECTION_SUFFIX.exec(value);
  return match && match.index > 0
    ? { model: value.slice(0, match.index), connectionId: match[1].toLowerCase() }
    : { model: value, connectionId: null };
}

export function formatModelReference(model, connectionId = null) {
  return connectionId ? `${model}@${connectionId}` : model;
}

export function effectiveConnectionId(modelInfo, request) {
  return modelInfo?.connectionId || request?.headers?.get("x-connection-id")?.trim() || null;
}
