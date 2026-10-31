import { normalizeNousFreeModels } from "open-sse/services/nous.js";

// Free OpenCode models that don't use the "-free" id suffix
const KNOWN_FREE_OPENCODE_MODELS = ["big-pickle"];

// Upstream returns "Model is unavailable" for this id (2026-09-02) — re-enable when fixed
const DEAD_FREE_OPENCODE_MODELS = new Set(["deepseek-v4-flash-free"]);

const positive = (n) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined);

function toSuggestions(models, { anthropic = false } = {}) {
  return (Array.isArray(models) ? models : [])
    .filter((m) => m && typeof m === "object" && typeof m.id === "string" && m.id.trim() !== "")
    .map((m) => {
      // Live limits only: the first positive number wins, top_provider is the served window.
      const contextLength = positive(m.top_provider?.context_length) ?? positive(m.context_length) ?? positive(m.context_window);
      const maxOutput = positive(m.top_provider?.max_completion_tokens) ?? positive(m.max_output_tokens);
      const modalities = m.architecture?.input_modalities;
      const listed = (Array.isArray(m.protocols) ? m.protocols : [])
        .map((p) => (typeof p === "string" ? p : p?.protocol))
        .filter((p) => typeof p === "string");
      const protocols = listed.length > 0 ? listed : anthropic ? ["anthropic-messages"] : [];
      const label = (v) => (typeof v === "string" && v.trim() ? v : undefined);
      return {
        id: m.id,
        name: (anthropic && label(m.display_name)) || label(m.name) || m.id,
        ...(contextLength && { contextLength }),
        ...(maxOutput && { maxOutput }),
        ...(Array.isArray(modalities) && { vision: modalities.includes("image") }),
        ...(protocols.length > 0 && { protocols }),
      };
    });
}

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

  // Plain OpenAI-style catalog ({data:[{id, name?, context_length?}]}): the live model list of
  // DotHoosh's public GET /v1/models and of other OpenAI-compatible aggregators. Live limits,
  // vision and protocols[] pass through when the row carries them.
  openai: (models) => toSuggestions(models),

  // DotHoosh's public GET /anthropic/v1/models: the same row shape plus display_name; a row that
  // names no protocol is served on the Anthropic route.
  anthropic: (models) => toSuggestions(models, { anthropic: true }),

  "opencode-free": (models) =>
    models
      .filter((m) => (m.id?.endsWith("-free") || KNOWN_FREE_OPENCODE_MODELS.includes(m.id)) && !DEAD_FREE_OPENCODE_MODELS.has(m.id))
      .map((m) => ({ id: m.id, name: m.id })),

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

  // MiniMax Code (mcode) live catalog: {providers:[{providerId:"minimax",
  // config:{models:{<id>:{name, limit, modalities, thinking_config}}}}]} —
  // arrives wrapped in a single-element array (see route normalization).
  "minimax-code": (raw) => {
    const env = Array.isArray(raw) ? raw[0] : raw;
    const p = (Array.isArray(env?.providers) ? env.providers : []).find((x) => x?.providerId === "minimax");
    const ms = p?.config?.models;
    if (!ms || typeof ms !== "object") return [];
    return Object.entries(ms)
      .filter(([id, m]) => typeof id === "string" && id.trim() !== "" && m && typeof m === "object")
      .map(([id, m]) => ({ id, name: m?.name || id, contextLength: Number(m?.limit?.context) || undefined }))
      .sort((a, b) => (b.contextLength || 0) - (a.contextLength || 0));
  },

  "airforce-free": (models) =>
    (Array.isArray(models) ? models : [])
      .filter((m) => (m.tier === "free" || m.id?.endsWith(":free")) && m.supports_chat === true && (!m.media_type || m.media_type === "chat" || m.media_type === "text"))
      .map((m) => ({ id: m.id, name: m.name || m.id, contextLength: m.context_length }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),

  "nous-free": normalizeNousFreeModels,
};
