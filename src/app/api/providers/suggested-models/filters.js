// Free OpenCode models that don't use the "-free" id suffix
const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];

export const FILTERS = {
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
      .filter((m) => m.id?.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(m.id))
      .map((m) => ({ id: m.id, name: m.id })),

  "mimo-free": (models) => {
    if (!models) return [];
    // models.dev returns a large catalog; filter for mimo models
    const mimoModels = Array.isArray(models)
      ? models.filter((m) => m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo"))
      : [];
    return mimoModels.map((m) => ({ id: m.id, name: m.name || m.id }));
  },
};
