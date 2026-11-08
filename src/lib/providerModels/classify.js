/**
 * Classify a raw model entry from a provider's /models endpoint.
 *
 * Provider catalogs are mixed: OpenAI's /models returns embeddings, whisper,
 * TTS, DALL·E and moderation alongside chat models. Registering those as `llm`
 * would put non-chat ids in the combo picker, where selecting one produces a
 * runtime failure that looks like a routing bug. Prefer the provider's own type
 * field when it has one, and fall back to id patterns only when it doesn't.
 */

/** Model id patterns that are NOT chat/LLM models. */
const NON_LLM_PATTERNS = [
  /embed/i,
  /\btts\b/i,
  /text-to-speech/i,
  /whisper/i,
  /speech/i,
  /dall-?e/i,
  /moderation/i,
  /transcribe/i,
  /rerank/i,
  /\bgpt-image/i,
  /stable-diffusion/i,
  /flux/i,
  /musicgen/i,
  /audiogen/i,
  /\bsora\b/i,
  /\bveo\b/i,
  /imagen/i,
  /codec/i,
];

/** Provider-declared type/kind values that are not chat. */
const NON_LLM_TYPES = new Set([
  "embedding",
  "embeddings",
  "image",
  "audio",
  "tts",
  "stt",
  "speech",
  "moderation",
  "rerank",
  "video",
]);

/** Extract the id from the many shapes providers use. */
export function modelIdOf(model) {
  if (typeof model === "string") return model;
  return model?.id || model?.name || model?.model || model?.slug || null;
}

/**
 * Is this entry a chat/LLM model?
 *
 * @param {Object|string} model - raw entry from a provider catalog
 * @returns {boolean}
 */
export function isChatModel(model) {
  const id = modelIdOf(model);
  if (!id) return false;

  // A provider that labels its own models is more reliable than pattern
  // matching — trust it in both directions.
  const declared = typeof model === "object" ? (model.type || model.kind || model.object) : null;
  if (typeof declared === "string") {
    const normalized = declared.toLowerCase();
    if (NON_LLM_TYPES.has(normalized)) return false;
    // "model" is OpenAI's generic `object` value and says nothing either way.
    if (normalized !== "model" && normalized !== "") {
      if (normalized === "llm" || normalized === "chat" || normalized === "text") return true;
    }
  }

  return !NON_LLM_PATTERNS.some((re) => re.test(id));
}

/**
 * Split a provider catalog into chat models and everything else.
 * @returns {{chat: Array, other: Array}}
 */
export function partitionChatModels(models) {
  const chat = [];
  const other = [];
  for (const model of models || []) {
    if (!modelIdOf(model)) continue;
    (isChatModel(model) ? chat : other).push(model);
  }
  return { chat, other };
}
