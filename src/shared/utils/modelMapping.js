export function modelMappingId(provider, upstreamModel) {
  return `${provider}\u0000${upstreamModel}`;
}

export function createModelMappingMap(mappings = []) {
  return new Map((Array.isArray(mappings) ? mappings : []).map((item) => [
    modelMappingId(item.provider, item.upstreamModel),
    item.mappedModel,
  ]));
}

export function getMappedModelName(mappingMap, provider, upstreamModel) {
  return mappingMap.get(modelMappingId(provider, upstreamModel)) || upstreamModel;
}

export function deriveMappedModelName(upstreamModel) {
  const value = String(upstreamModel || "").trim();
  const separator = value.lastIndexOf("/");
  return separator >= 0 ? value.slice(separator + 1) : value;
}

export function findMappedCandidates(models, mappings, mappedModel) {
  const mappingMap = createModelMappingMap(mappings);
  const target = String(mappedModel || "").trim();
  return (Array.isArray(models) ? models : []).filter((item) =>
    getMappedModelName(mappingMap, item.provider, item.upstreamModel) === target,
  );
}
