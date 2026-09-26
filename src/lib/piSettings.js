const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 16384;

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function normalizeModel(model, existingModel, resolveCapabilities) {
  const source = typeof model === "string" ? { id: model } : (model || {});
  const id = source.id || "provider/model-id";
  const capabilities = resolveCapabilities(id) || {};

  return {
    ...existingModel,
    id,
    name: source.name || existingModel?.name || id,
    contextWindow:
      positiveInteger(source.contextWindow ?? source.context_window)
      || positiveInteger(existingModel?.contextWindow ?? existingModel?.context_window)
      || positiveInteger(capabilities.contextWindow ?? capabilities.context_window)
      || DEFAULT_CONTEXT_WINDOW,
    maxTokens:
      positiveInteger(source.maxTokens ?? source.max_tokens)
      || positiveInteger(existingModel?.maxTokens ?? existingModel?.max_tokens)
      || positiveInteger(capabilities.maxOutput ?? capabilities.max_output)
      || DEFAULT_MAX_TOKENS,
  };
}

export function buildPiProvider(existingProvider, { baseUrl, apiKey, models, model }, resolveCapabilities) {
  const normalizedBaseUrl = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  const requestedModels = Array.isArray(models) && models.length > 0 ? models : [model || "provider/model-id"];
  const existingModels = Array.isArray(existingProvider?.models) ? existingProvider.models : [];
  const existingById = new Map(existingModels.map((entry) => [entry.id, entry]));
  const selected = requestedModels.map((entry) => {
    const id = typeof entry === "string" ? entry : entry?.id;
    return normalizeModel(entry, existingById.get(id), resolveCapabilities);
  });
  const selectedIds = new Set(selected.map((entry) => entry.id));

  return {
    ...existingProvider,
    baseUrl: normalizedBaseUrl,
    apiKey: apiKey || existingProvider?.apiKey || "sk_9router",
    api: existingProvider?.api || "openai-completions",
    models: [...existingModels.filter((entry) => !selectedIds.has(entry.id)), ...selected],
  };
}
