import opencodeRegistry from "open-sse/providers/registry/opencode.js";

// Free OpenCode models that don't use the "-free" id suffix
const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];

// Upstream returns "Model is unavailable" for this id (2026-09-02) — re-enable when fixed
const DEAD_FREE_OPENCODE_MODELS = new Set(["deepseek-v4-flash-free"]);

// tolerant id reader: falls back to `name` when upstream changes its schema
function opencodeModelId(m) {
  const raw = typeof m?.id === "string" && m.id ? m.id : (typeof m?.name === "string" ? m.name : "");
  return raw.trim();
}

// A free OpenCode model carries a free suffix (any reasonable separator) or is
// explicitly known; dead ids are always dropped.
function isFreeOpencodeModel(m) {
  const id = opencodeModelId(m);
  if (!id || DEAD_FREE_OPENCODE_MODELS.has(id)) return false;
  const lower = id.toLowerCase();
  return (
    lower.endsWith("-free") ||
    lower.endsWith(":free") ||
    lower.endsWith(" free") ||
    KNOWN_FREE_OPENCODE_MODELS.includes(id) ||
    KNOWN_FREE_OPENCODE_MODELS.some((known) => known.toLowerCase() === lower)
  );
}

// Built-in fallback suggestions per filter type, used when the live upstream
// catalogue is unreachable. Single-sourced from the provider registry.
export const FALLBACK_SUGGESTIONS = {
  "opencode-free": (opencodeRegistry.models || [])
    .filter((m) => typeof m?.id === "string" && m.id)
    .map((m) => ({ id: m.id, name: m.name || m.id })),
};

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
    (Array.isArray(models) ? models : [])
      .filter(isFreeOpencodeModel)
      .map((m) => ({ id: opencodeModelId(m), name: opencodeModelId(m) })),

  // Generic OpenAI-compatible catalogue ({ data: [{ id, ... }] }) - accept any
  // string id so unknown-type fetchers fail open instead of 400ing.
  "openai": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => typeof m?.id === "string" && m.id.trim() !== "")
      .map((m) => ({ id: m.id, name: m.name || m.id })),

  // Go subscription catalogue — every /models id is selectable; the endpoint lane
  // per model is resolved by the family regex (see open-sse/providers/models/helpers.js)
  "opencode-go": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => typeof m?.id === "string")
      .map((m) => ({ id: m.id, name: m.id })),

  // models.dev returns a large catalog; keep only mimo models
  "mimo-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => m.id?.startsWith("mimo") || m.name?.toLowerCase().includes("mimo"))
      .map((m) => ({ id: m.id, name: m.name || m.id })),

  "airforce-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => (m.tier === "free" || m.id?.endsWith(":free")) && m.supports_chat === true && (!m.media_type || m.media_type === "chat" || m.media_type === "text"))
      .map((m) => ({ id: m.id, name: m.name || m.id, contextLength: m.context_length }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
};
