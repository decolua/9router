// Shared compress-feature constants surfaced under System → Compress.
// CAVEMAN_LEVELS + WENYAN_LOCALES moved here from endpointConstants.js so the
// Compress pages and the legacy Endpoint page share one source of truth.

export const WENYAN_LOCALES = ["zh-CN", "zh-TW"];

export const CAVEMAN_LEVELS = [
  { id: "lite", label: "Lite", desc: "Drop filler, keep grammar" },
  { id: "full", label: "Full", desc: "Drop articles, fragments OK" },
  { id: "ultra", label: "Ultra", desc: "Telegraphic, max compression" },
  { id: "wenyan-lite", label: "文 Lite", desc: "Classical Chinese, light compression", wenyan: true },
  { id: "wenyan", label: "文 Full", desc: "Maximum 文言文, 80-90% reduction", wenyan: true },
  { id: "wenyan-ultra", label: "文 Ultra", desc: "Extreme classical compression", wenyan: true },
];

// UI-only level list for the Ponytail toggle. The ids ("lite","full") MUST
// match PONYTAIL_PROMPTS keys in open-sse/rtk/ponytailPrompts.js.
export const PONYTAIL_LEVELS = [
  { id: "lite", label: "Lite", desc: "Tail-focus + terse" },
  { id: "full", label: "Full", desc: "Tail-focus, no filler, telegraphic" },
];
