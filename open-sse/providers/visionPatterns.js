// Name-based vision detection — last resort when neither the catalog file nor
// the capability tables know a model. Vendors put the modality in the id
// ("qwen3-vl-plus", "glm-4.6v", "deepseek-v4-flash-vision-exp"), so a custom or
// freshly released model still gets image input instead of silently dropping it.
//
// Only ever turns vision ON. Never used to turn a declared capability off.

const SEP = "[-_/:.]";

// Image GENERATION, video generation, and non-chat models also carry these
// words but take no image input — checked first so they can never match.
const NOT_VISION = new RegExp(
  [
    `(^|${SEP})(image|img)(${SEP}|$)`,
    "stable-image", "gen[0-9]_image", "nanobanana", "imagine",
    "t2v", "i2v", "flux", "dall", "sdxl", "diffusion",
    "embed", "rerank", "guard", "moderation",
    "tts", "stt", "whisper", "voice", "speech", "audio",
  ].join("|"),
  "i"
);

// Explicit modality words, plus the "<digit>v" suffix vendors use for vision
// variants (glm-4.6v, glm-5v-turbo). The digit-v branch requires a dotted
// version so the never-shipped `gpt-4v` cannot match.
const VISION_NAME = new RegExp(
  [
    `(^|${SEP})(vision|vl|vlm|multimodal|omni|visual)(${SEP}|$)`,
    `[0-9]\\.[0-9]+v(${SEP}|$)`,
    `(^|${SEP})glm-[0-9]+v(${SEP}|$)`,
    "(^|[-_/:.])(llava|pixtral|internvl|cogvlm|minicpm-v|moondream|idefics|fuyu)",
  ].join("|"),
  "i"
);

// Does this model id look like a vision model? Name signal only.
export function looksLikeVisionModel(modelId) {
  if (!modelId) return false;
  const id = String(modelId).toLowerCase();
  if (NOT_VISION.test(id)) return false;
  return VISION_NAME.test(id);
}
