// Model metadata registry
// Only define models that differ from DEFAULT_MODEL_INFO
// Custom entries are merged over default
const DEFAULT_MODEL_INFO = {
  type: ["chat"],
  contextWindow: 200000,
};

export const MODEL_INFO = {
  // DeepSeek official platform — 1M context (2026-06)
  "deepseek-v4-pro":  { contextWindow: 1000000 },
  "deepseek-v4-flash": { contextWindow: 1000000 },
  "deepseek-chat":     { contextWindow: 1000000 },
  "deepseek-reasoner": { contextWindow: 1000000 },
  "deepseek-v3.2":     { contextWindow: 1000000 },
  "deepseek-v4-pro-max":  { contextWindow: 1000000 },
  "deepseek-v4-pro-none": { contextWindow: 1000000 },
};

export function getModelInfo(modelId) {
  return { ...DEFAULT_MODEL_INFO, ...MODEL_INFO[modelId] };
}
