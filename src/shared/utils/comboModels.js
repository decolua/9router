export function getComboModelValue(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object" && typeof entry.model === "string") return entry.model;
  return "";
}

export function getComboModelConnectionId(entry) {
  if (entry && typeof entry === "object" && typeof entry.connectionId === "string") return entry.connectionId;
  return "";
}

function getProviderPrefix(model) {
  const value = String(model || "").trim();
  const slash = value.indexOf("/");
  return slash >= 0 ? value.slice(0, slash) : value;
}

export function setComboModelValue(entry, model) {
  const trimmed = String(model || "").trim();
  const connectionId = getComboModelConnectionId(entry);
  const sameProvider = getProviderPrefix(getComboModelValue(entry)) === getProviderPrefix(trimmed);
  return connectionId && sameProvider ? { model: trimmed, connectionId } : trimmed;
}

export function setComboModelConnectionId(entry, connectionId) {
  const model = getComboModelValue(entry).trim();
  const id = String(connectionId || "").trim();
  return id ? { model, connectionId: id } : model;
}

export function sanitizeComboModels(models) {
  if (!Array.isArray(models)) return [];
  return models
    .map((entry) => {
      const model = getComboModelValue(entry).trim();
      if (!model) return null;
      const connectionId = getComboModelConnectionId(entry).trim();
      return connectionId ? { model, connectionId } : model;
    })
    .filter(Boolean);
}
