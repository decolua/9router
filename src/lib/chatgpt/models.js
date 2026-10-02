export const MAX_CHATGPT_MODELS = 5;
export const CHATGPT_MODEL_PREFIX = "9router/";

// Use a namespace so a router model can never shadow a subscription model.
export function codexModelId(id) {
  return `${CHATGPT_MODEL_PREFIX}${id}`;
}

export function selectedModels(settings) {
  return Array.isArray(settings.chatgptIntegration?.models)
    ? settings.chatgptIntegration.models : [];
}

export function selectChatGPTModels(ids, available) {
  if (!Array.isArray(ids) || ids.length > MAX_CHATGPT_MODELS ||
      ids.some(id => typeof id !== "string") || new Set(ids).size !== ids.length) {
    throw new Error(`Choose up to ${MAX_CHATGPT_MODELS} distinct models.`);
  }
  const byId = new Map(available.map(model => [model.id, model]));
  return ids.map(id => {
    const model = byId.get(id);
    if (!model) throw new Error(`Model is no longer available: ${id}`);
    if (model.capabilities?.tools === false) {
      throw new Error(`This model does not support tools: ${id}`);
    }
    const caps = model.capabilities || {};
    return {
      id,
      name: model.name || id,
      contextWindow: Number.isFinite(model.context_length) && model.context_length >= 4096
        ? model.context_length : 32768,
      imageInput: caps.vision === true || caps.imageInput === true,
    };
  });
}

// Saved selections are an allow-list, not an immutable capability snapshot.
// Catalog sync must pick up Combo edits, capability overrides and provider
// discovery changes without requiring the user to save the same selection again.
export function refreshSelectedModels(models, available) {
  const currentById = new Map((available || []).map(model => [model.id, model]));
  return (models || []).map(saved => {
    const current = currentById.get(saved.id);
    if (!current) return saved;
    const caps = current.capabilities || {};
    return {
      ...saved,
      name: current.name || saved.name || saved.id,
      contextWindow: Number.isFinite(current.context_length) && current.context_length >= 4096
        ? current.context_length : saved.contextWindow,
      imageInput: caps.vision === true || caps.imageInput === true,
    };
  });
}

export function chatGPTManifest(models) {
  return {
    version: 1,
    models: models.map(model => ({ ...model, slug: codexModelId(model.id) })),
  };
}
