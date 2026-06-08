// Model metadata registry
// Only define models that differ from DEFAULT_MODEL_INFO
// Custom entries are merged over default
const DEFAULT_MODEL_INFO = {
  type: ["chat"],
  contextWindow: 1048576,
};

// Per-model context window overrides
// Models not listed inherit DEFAULT_MODEL_INFO (1M tokens)
export const MODEL_INFO = {
  // OpenAI
  "gpt-4o": { contextWindow: 128000 },
  "gpt-4o-mini": { contextWindow: 128000 },
  "gpt-4-turbo": { contextWindow: 128000 },
  "gpt-4.1": { contextWindow: 1048576 },
  "gpt-4.1-mini": { contextWindow: 1048576 },
  "gpt-4.1-nano": { contextWindow: 1048576 },
  "o1": { contextWindow: 200000 },
  "o1-mini": { contextWindow: 200000 },
  "o3": { contextWindow: 200000 },
  "o3-mini": { contextWindow: 200000 },
  "o3-pro": { contextWindow: 200000 },
  "o4-mini": { contextWindow: 100000 },

  // Anthropic
  "claude-sonnet-4-20250514": { contextWindow: 200000 },
  "claude-opus-4-20250514": { contextWindow: 200000 },
  "claude-3-5-sonnet-20241022": { contextWindow: 200000 },

  // Google Gemini — 1M is default, no override needed

  // DeepSeek
  "deepseek-v4-pro": { contextWindow: 1048576 },
  "deepseek-v4-pro-max": { contextWindow: 1048576 },
  "deepseek-v4-pro-none": { contextWindow: 1048576 },
  "deepseek-v4-flash": { contextWindow: 1048576 },
  "deepseek-chat": { contextWindow: 65536 },
  "deepseek-reasoner": { contextWindow: 65536 },

  // Cohere
  "command-r-plus-08-2024": { contextWindow: 128000 },
  "command-r-08-2024": { contextWindow: 128000 },
  "command-a-03-2025": { contextWindow: 128000 },

  // Mistral
  "mistral-large-latest": { contextWindow: 131072 },
  "codestral-latest": { contextWindow: 256000 },

  // Grok
  "grok-3": { contextWindow: 131072 },
  "grok-4": { contextWindow: 1048576 },

  // xAI
  "grok-4-fast-reasoning": { contextWindow: 1048576 },

  // Llama
  "llama-3.3-70b-versatile": { contextWindow: 128000 },
};

export function getModelInfo(modelId) {
  return { ...DEFAULT_MODEL_INFO, ...MODEL_INFO[modelId] };
}
