export function normalizeComboModelIds(models) {
  if (!Array.isArray(models)) return null;
  const ids = models.map((model) => {
    if (typeof model === "string") return model;
    if (model && typeof model === "object" && !Array.isArray(model)) {
      if (typeof model.fullModel === "string") return model.fullModel;
      if (typeof model.provider === "string" && typeof model.model === "string") {
        return `${model.provider}/${model.model}`;
      }
    }
    return null;
  });
  return ids.every((id) => typeof id === "string" && id.trim()) ? ids : null;
}
