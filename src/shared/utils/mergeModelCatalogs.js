export function mergeModelCatalogs(...catalogs) {
  const seen = new Set();
  const merged = [];

  for (const catalog of catalogs) {
    for (const model of catalog || []) {
      const id = typeof model?.id === "string" ? model.id.trim() : "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      merged.push(model);
    }
  }

  return merged;
}
