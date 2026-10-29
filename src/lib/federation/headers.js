// Federation response headers (FED-005) — spec §3.4/§3.5.
//
// While an edge is DEGRADED, dashboard responses carry
// X-Federation-State: degraded so the UI (and any API consumer) can tell
// that reads are served from the local replica and writes were queued —
// the dashboard never silently lies about write commitment (spec §6.5).
//
// FED-004 already sets X-Federation-State: degraded +
// X-Federation-Queued-Write-Id on QUEUED-WRITE responses (202/503) in
// queue.js handleDegradedWrite. This module covers the READ side: a thin
// header add on responses that fall through to local handlers while the
// edge is DEGRADED. The decision is a pure function so custom-server.js
// stays thin and tests can drive it without Next.js.
import { STATES } from "./constants.js";

export const FEDERATION_STATE_HEADER = "X-Federation-State";

// Decide whether a response should carry X-Federation-State: degraded.
// Pure decision — no I/O, no state reads:
//   - state === 'degraded' → true (the edge is serving from the local
//     replica; every dashboard response must say so)
//   - anything else (linked/recovering/standalone/central/unknown) → false
//     (LINKED responses are proxied upstream with the central's own
//     headers; RECOVERING is a transient state that still proxies; the
//     banner surfaces those states instead)
export function shouldTagDegraded(state) {
  return state === STATES.DEGRADED;
}

// Add X-Federation-State: degraded to a response header object (in place,
// returns the same object for chaining). Never overwrites an existing
// value — the queued-write path (queue.js) sets its own headers before
// this runs, and a response that already carries the header must keep it.
export function tagDegraded(headers = {}) {
  if (headers && typeof headers === "object" && !headers[FEDERATION_STATE_HEADER]) {
    headers[FEDERATION_STATE_HEADER] = STATES.DEGRADED;
  }
  return headers;
}
