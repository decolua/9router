// Model metadata registry
// Only define models that differ from DEFAULT_MODEL_INFO
// Custom entries are merged over default
const DEFAULT_MODEL_INFO = {
  type: ["chat"],
  contextWindow: 200000,
};

export const MODEL_INFO = {};

export function getModelInfo(modelId) {
  return { ...DEFAULT_MODEL_INFO, ...MODEL_INFO[modelId] };
}
