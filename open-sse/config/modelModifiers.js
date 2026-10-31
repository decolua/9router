// Explicit model-ID opt-ins. Keep the upstream spelling shared by OpenAI and Codex.
export const MODEL_SERVICE_TIER_MODIFIERS = Object.freeze({
  fast: "priority",
  standard: "default",
});

export const MODEL_SERVICE_TIER_PROVIDERS = new Set(["openai", "codex"]);
