export function collectBulkTestModelIds({
  models = [],
  kiloFreeModels = [],
  modelAliases = {},
  providerStorageAlias,
  providerInfo = {},
  disabledModelIds = [],
}) {
  const disabledSet = new Set(disabledModelIds);
  const ids = [];
  const seen = new Set();

  const addId = (id) => {
    if (!id || seen.has(id) || disabledSet.has(id)) return;
    seen.add(id);
    ids.push(id);
  };

  const builtInModels = [
    ...models,
    ...kiloFreeModels.filter((freeModel) => !models.some((model) => model.id === freeModel.id)),
  ].filter((model) => !model.type || model.type === "llm");

  builtInModels.forEach((model) => addId(model.id));

  const prefix = `${providerStorageAlias}/`;
  Object.entries(modelAliases).forEach(([alias, fullModel]) => {
    if (!fullModel?.startsWith(prefix)) return;
    const modelId = fullModel.slice(prefix.length);
    if (providerInfo.passthroughModels) {
      if (!models.some((model) => model.id === modelId)) addId(modelId);
      return;
    }
    if (!models.some((model) => model.id === modelId) && alias === modelId) {
      addId(modelId);
    }
  });

  return ids;
}
