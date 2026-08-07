// FederationStatus banner view logic (FED-005) — pure module, no React.
//
// Maps the local federation status payload (from /api/federation/local-status)
// to what the banner renders: a badge variant + label per state, and a
// revision-lag string. Kept framework-free so vitest can test every render
// state without jsdom/@testing-library (tests/ is node-only).
//
// Contract with the payload (src/lib/federation/server.js
// buildLocalStatusPayload):
//   { role: 'standalone'|'central'|'edge', last_state?: 'linked'|'degraded'|
//     'recovering', revisionLag: number, ... }
//   - standalone → render nothing (zero drift)
//   - central → render nothing (the banner is an EDGE UX; central is the
//     authoritative instance and has no failover state to show)
//   - edge → badge per last_state + lag text when revisionLag > 0
//   - unknown/error → null (hide quietly, retry next poll)
import { STATES } from "./constants.js";

// Badge variant per state (matches src/shared/components/Badge.js variants).
export const STATE_BADGE_VARIANTS = Object.freeze({
  [STATES.LINKED]: "success",
  [STATES.DEGRADED]: "error",
  [STATES.RECOVERING]: "info",
});

// Human label per state (EN literals — i18n fallback covers other locales).
export const STATE_LABELS = Object.freeze({
  [STATES.LINKED]: "Federation linked",
  [STATES.DEGRADED]: "Federation degraded",
  [STATES.RECOVERING]: "Federation recovering",
});

// Icon per state (material-symbols-outlined names).
export const STATE_ICONS = Object.freeze({
  [STATES.LINKED]: "cloud_done",
  [STATES.DEGRADED]: "cloud_off",
  [STATES.RECOVERING]: "sync",
});

// Map a local-status payload to banner view state.
// Returns null when the banner must render NOTHING:
//   - standalone / central roles (banner is an edge-only UX)
//   - missing/invalid last_state (unknown → hide quietly)
//   - malformed payload (defensive)
// Returns { variant, label, icon, lagText } for edges.
export function federationStatusView(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.role !== "edge") return null;
  const state = payload.last_state;
  if (!state || !STATE_BADGE_VARIANTS[state]) return null;
  return {
    variant: STATE_BADGE_VARIANTS[state],
    label: STATE_LABELS[state],
    icon: STATE_ICONS[state],
    lagText: formatRevisionLag(payload.revisionLag),
  };
}

// Format the revision lag. Returns "" when lag is 0/absent (no lag text —
// the banner shows the badge only). "behind N revisions" for lag > 0.
export function formatRevisionLag(lag) {
  const n = Number(lag);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `behind ${n} revision${n === 1 ? "" : "s"}`;
}
