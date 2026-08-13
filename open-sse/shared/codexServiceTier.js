// Codex service tier normalization — shared by the chat executor and the image adapter
// so both paths agree on what "fast" means upstream.
//
// Codex's Responses backend only recognizes "priority" as an accelerated tier. Clients
// (and 9Router's own UI) say "fast", so map it. Anything else is dropped rather than
// forwarded — an unknown service_tier makes the backend reject the whole request with
// "routing_unsupported".

export const CODEX_FAST_TIER = "fast";
export const CODEX_PRIORITY_TIER = "priority";

/**
 * @param {unknown} tier - Raw service_tier from the client request
 * @returns {string|null} "priority" when the request asked for the fast tier, else null
 */
export function normalizeCodexServiceTier(tier) {
  if (typeof tier !== "string") return null;
  const normalized = tier.trim().toLowerCase();
  if (normalized === CODEX_FAST_TIER || normalized === CODEX_PRIORITY_TIER) {
    return CODEX_PRIORITY_TIER;
  }
  return null;
}
