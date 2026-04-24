// Model metadata registry
// Only define models that differ from DEFAULT_MODEL_INFO
// Custom entries are merged over default

interface ModelInfo {
  type: string[];
  contextWindow: number;
}

const DEFAULT_MODEL_INFO: ModelInfo = {
  type: ["chat"],
  contextWindow: 200000,
};

export const MODEL_INFO: Record<string, Partial<ModelInfo>> = {};

export function getModelInfo(modelId: string): ModelInfo {
  return { ...DEFAULT_MODEL_INFO, ...(MODEL_INFO[modelId] || {}) };
}
