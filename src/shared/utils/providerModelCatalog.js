// Shared helpers for provider model catalog parsing and normalization.

export function parseOpenAIStyleModels(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function copySerializable(value) {
  if (value === undefined) return undefined;

  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return undefined;
    return JSON.parse(serialized);
  } catch {
    return undefined;
  }
}

function normalizeModalities(model) {
  const input = copySerializable(model?.input_modalities ?? model?.inputModalities);
  const output = copySerializable(model?.output_modalities ?? model?.outputModalities);
  const modalities = {};

  if (Array.isArray(input)) modalities.input = input;
  if (Array.isArray(output)) modalities.output = output;

  return Object.keys(modalities).length > 0 ? modalities : undefined;
}

function normalizeChutesModel(model) {
  const id = model?.id;
  if (typeof id !== "string") return null;

  const name = typeof model?.name === "string" && model.name.trim() ? model.name : id;
  const normalized = { id, name };
  const contextLength = model?.context_length ?? model?.contextLength;

  if (Number.isFinite(contextLength)) {
    normalized.contextLength = contextLength;
  }

  const ownedBy = model?.owned_by ?? model?.ownedBy;
  if (typeof ownedBy === "string") {
    normalized.ownedBy = ownedBy;
  }

  const pricing = copySerializable(model?.pricing);
  if (pricing !== undefined) {
    normalized.pricing = pricing;
  }

  const modalities = normalizeModalities(model);
  if (modalities !== undefined) {
    normalized.modalities = modalities;
  }

  const features = copySerializable(model?.supported_features ?? model?.supportedFeatures);
  if (features !== undefined) {
    normalized.features = features;
  }

  return normalized;
}

export function normalizeChutesModels(data) {
  const deduped = new Map();

  for (const model of parseOpenAIStyleModels(data)) {
    const normalized = normalizeChutesModel(model);
    if (!normalized || deduped.has(normalized.id)) continue;
    deduped.set(normalized.id, normalized);
  }

  return Array.from(deduped.values()).sort((a, b) => {
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}
