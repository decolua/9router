export function getStatusVariant(isActive, effectiveStatus) {
  if (isActive === false) return "default";
  if (effectiveStatus === "active" || effectiveStatus === "success") return "success";
  if (effectiveStatus === "error" || effectiveStatus === "expired" || effectiveStatus === "unavailable") return "error";
  return "default";
}

export function filterActiveConnections(connections) {
  if (!Array.isArray(connections)) return [];
  return connections.filter((connection) => connection?.isActive !== false);
}
