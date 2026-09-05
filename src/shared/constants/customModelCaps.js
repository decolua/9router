// User-toggleable capability flags for custom models. Keys mirror
// open-sse/providers/capabilities.js OVERRIDABLE_CAPABILITY_KEYS exactly — the
// backend whitelist that persists these overrides. Order = display order.
export const CUSTOM_MODEL_CAP_OPTIONS = [
  { key: "vision", label: "Vision", icon: "image", desc: "Model can read images" },
  { key: "pdf", label: "PDF", icon: "picture_as_pdf", desc: "Model can read PDF / documents" },
  { key: "audioInput", label: "Audio in", icon: "graphic_eq", desc: "Model can read audio" },
  { key: "videoInput", label: "Video in", icon: "movie", desc: "Model can read video" },
  { key: "imageOutput", label: "Image out", icon: "wallpaper", desc: "Model can generate images" },
  { key: "audioOutput", label: "Audio out", icon: "volume_up", desc: "Model can generate audio" },
  { key: "search", label: "Search", icon: "travel_explore", desc: "Model has built-in web search / grounding" },
  { key: "reasoning", label: "Reasoning", icon: "neurology", desc: "Model supports thinking / reasoning" },
];

// Blank caps object: every flag false. Spread into initial React state.
export const EMPTY_CUSTOM_MODEL_CAPS = Object.freeze(
  Object.fromEntries(CUSTOM_MODEL_CAP_OPTIONS.map((o) => [o.key, false])),
);
