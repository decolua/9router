import { isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "@/shared/constants/providers";

// Provider nodes size to their label within these bounds; the layout spaces the ellipse for the widest one.
export const TOPOLOGY_GEOMETRY = Object.freeze({
  providerMinWidth: 150,
  providerMaxWidth: 320,
  providerGap: 24,
  minRadiusX: 320,
  minRadiusY: 200,
});

// Border + padding + icon + gaps + status dot of a provider node, and a generous
// per-character width for its text-base label (estimate only: used for spacing).
const NODE_CHROME_WIDTH = 96;
const LABEL_CHAR_WIDTH = 9;

export const FALLBACK_COLOR_PALETTE = Object.freeze([
  "#0ea5e9", "#a855f7", "#f59e0b", "#10b981",
  "#ec4899", "#6366f1", "#14b8a6", "#f97316",
]);

function fnv1a(value) {
  const input = String(value || "");
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Stable color for providers without a configured brand color (custom nodes). */
export function getFallbackProviderColor(providerId) {
  return FALLBACK_COLOR_PALETTE[fnv1a(providerId) % FALLBACK_COLOR_PALETTE.length];
}

/** Text badge for compatible nodes when their icon cannot load. */
export function getCompatibleBadge(providerId, apiType) {
  if (isAnthropicCompatibleProvider(providerId)) return "AC";
  if (isOpenAICompatibleProvider(providerId)) return apiType === "responses" ? "OR" : "OC";
  return "";
}

/** Upper estimate of a provider node's rendered width, clamped to the node's min/max. */
export function estimateProviderNodeWidth(label) {
  const width = NODE_CHROME_WIDTH + String(label || "").length * LABEL_CHAR_WIDTH;
  return Math.min(TOPOLOGY_GEOMETRY.providerMaxWidth, Math.max(TOPOLOGY_GEOMETRY.providerMinWidth, width));
}

/** Center of node `index` of `count` on the layout ellipse, starting at the top, clockwise. */
export function getTopologyPosition(index, count, nodeWidth = TOPOLOGY_GEOMETRY.providerMinWidth) {
  const n = Math.max(count, 1);
  const minArcWidth = nodeWidth + TOPOLOGY_GEOMETRY.providerGap;
  const radiusX = Math.max(TOPOLOGY_GEOMETRY.minRadiusX, (minArcWidth * n) / (2 * Math.PI));
  const radiusY = Math.max(TOPOLOGY_GEOMETRY.minRadiusY, radiusX * 0.55);
  const angle = -Math.PI / 2 + (2 * Math.PI * index) / n;
  return { x: radiusX * Math.cos(angle), y: radiusY * Math.sin(angle), angle };
}
