import { getModelMappings } from "@/lib/localDb";
import { createModelMappingMap, getMappedModelName } from "@/shared/utils/modelMapping.js";
import { getModelMappingCatalog } from "@/shared/services/modelMappingCatalog.js";

let catalogCache = { expiresAt: 0, models: [] };

async function getRawCatalog() {
  if (catalogCache.expiresAt > Date.now()) return catalogCache.models;
  const models = await getModelMappingCatalog();
  catalogCache = { expiresAt: Date.now() + 30000, models };
  return models;
}

export async function getMappedModelCandidates(mappedModel) {
  const target = String(mappedModel || "").trim();
  if (!target) return [];
  const [models, mappings] = await Promise.all([getRawCatalog(), getModelMappings()]);
  const mappingMap = createModelMappingMap(mappings);
  return models.flatMap((model) => {
    if (!model.provider || !model.upstreamModel) return [];
    if (getMappedModelName(mappingMap, model.provider, model.upstreamModel) !== target) return [];
    return [{
      provider: model.provider,
      model: model.upstreamModel,
      modelString: model.routeModel,
    }];
  });
}

export function clearModelMappingCatalogCache() {
  catalogCache = { expiresAt: 0, models: [] };
}
