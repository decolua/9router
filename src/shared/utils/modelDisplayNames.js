import { getModelDisplayNames } from "@/lib/localDb";

export async function getModelDisplayNameMap() {
  try {
    return await getModelDisplayNames();
  } catch (error) {
    console.log("Could not fetch model display names");
    return {};
  }
}

export function applyModelDisplayNames(models, modelDisplayNames) {
  const displayedModels = [];
  const seenDisplayedIds = new Set();

  for (const model of models) {
    const originModelId = model.id;
    const displayModelId = modelDisplayNames[originModelId];
    const finalModel = displayModelId
      ? { ...model, id: displayModelId, origin_model_id: originModelId }
      : model;

    if (!finalModel?.id || seenDisplayedIds.has(finalModel.id)) continue;
    seenDisplayedIds.add(finalModel.id);
    displayedModels.push(finalModel);
  }

  return displayedModels;
}

export function getOriginModelIds(models) {
  return new Set(
    models
      .map((model) => model?.origin_model_id || model?.id)
      .filter(
        (modelId) => typeof modelId === "string" && modelId.trim() !== "",
      ),
  );
}
