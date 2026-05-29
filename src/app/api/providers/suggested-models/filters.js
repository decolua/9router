// Suggested-model filters for the "Import suggested models" dashboard flow.
// Extracted from route.js so the filter logic is unit-testable (#1535).

// Free OpenCode models that are routable but do NOT use the conventional
// "-free" suffix, so the suffix-only filter would hide them. `big-pickle` is
// such a model — it's handled in open-sse/executors/opencode.js
// (MESSAGES_MODELS) yet never appeared in the suggested-models UI. See #1535.
export const KNOWN_FREE_OPENCODE_MODELS = new Set(["big-pickle"]);

export const SUGGESTED_MODEL_FILTERS = {
  "openrouter-free": (models) =>
    models
      .filter(
        (m) =>
          m.pricing?.prompt === "0" &&
          m.pricing?.completion === "0" &&
          m.context_length >= 200000
      )
      .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
      .sort((a, b) => b.contextLength - a.contextLength),

  "opencode-free": (models) =>
    models
      // Include conventional "-free" models plus known free models that lack the suffix (#1535).
      .filter((m) => m.id?.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.has(m.id))
      .map((m) => ({ id: m.id, name: m.id })),
};
