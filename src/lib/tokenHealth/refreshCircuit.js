// T3.3 — refresh-circuit policy for the proactive OAuth sweep (spec
// docs/orchestration/OMNIROUTE-DIFF.md T-C, ported from OmniRoute
// tokenRefreshCircuit.ts). PURE module: zero imports, so both
// tokenHealth/scheduler.js and the T3.1 credentialHealth scheduler can share
// the `canRefreshNow` predicate without dragging the sqlite/providers graph
// into module load.
//
// The circuit lives in `providerSpecificData.refreshCircuit = { until, attempts }`
// on the connection row. `until` is an ISO stamp; `attempts` counts consecutive
// refresh failures since the last success and indexes the backoff ladder.

export const REFRESH_WINDOW_MS = 10 * 60 * 1000;
export const BACKOFF_MS = [5, 10, 30, 120].map((m) => m * 60 * 1000);
export const EXPIRED_BUDGET_FAILURES = 3;
export const EXPIRED_BUDGET_WINDOW_MS = 5 * 60 * 1000;

// Providers whose refresh_token rotates on every successful refresh, so an
// invalid_grant usually means a dual-consumer race (F26/RH3), not a dead
// credential. The sweep NEVER persists `refreshToken` in a failure patch
// (failures only touch providerSpecificData/testStatus), which structurally
// preserves the RT for these providers; the set documents that guarantee and
// guards against any future null-wipe being added here.
export const PRESERVE_REFRESH_TOKEN_PROVIDERS = new Set(["claude", "codex", "grok-cli", "xai"]);

function parseMs(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** True for connections the sweep may try to refresh (OAuth + a stored RT). */
export function isOAuthRefreshCandidate(connection) {
  if (!connection || !connection.id) return false;
  const authType = String(connection.authType || "").toLowerCase().replace(/_/g, "");
  if (authType !== "oauth") return false;
  return typeof connection.refreshToken === "string" && connection.refreshToken.length > 0;
}

/** Epoch ms until which refresh attempts are suppressed, or null when open. */
export function getCircuitUntil(connection) {
  return parseMs(connection?.providerSpecificData?.refreshCircuit?.until);
}

/**
 * Shared predicate (also imported by the T3.1 credentialHealth sweep): false
 * while a persisted refresh-circuit backoff is running, so health probes don't
 * re-test a connection whose OAuth refresh is in error backoff. Fail-open on
 * any malformed state — a broken circuit must never block credential work.
 */
export function canRefreshNow(connection, now = Date.now()) {
  const until = getCircuitUntil(connection);
  if (until === null) return true;
  return now >= until;
}

/**
 * Circuit update after a refresh failure on a NOT-yet-expired token:
 * attempts++ and until = now + 5→10→30→120min (clamped at the last step).
 * Returns the providerSpecificData DELTA only — callers merge it over the
 * freshest row data.
 */
export function nextFailureCircuit(connection, now = Date.now()) {
  const prev = connection?.providerSpecificData?.refreshCircuit;
  const attempts = (Number.isFinite(prev?.attempts) ? prev.attempts : 0) + 1;
  const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
  return {
    refreshCircuit: { until: new Date(now + delay).toISOString(), attempts },
  };
}

/**
 * Circuit update when the expired-token retry budget runs out and the
 * connection is being marked testStatus:"expired": longest backoff step, so
 * the sweep (and the T3.1 probes) leave it alone for 2h before giving it a
 * fresh budget.
 */
export function expiryMarkCircuit(connection, now = Date.now()) {
  const prev = connection?.providerSpecificData?.refreshCircuit;
  const attempts = (Number.isFinite(prev?.attempts) ? prev.attempts : 0) + 1;
  return {
    refreshCircuit: {
      until: new Date(now + BACKOFF_MS[BACKOFF_MS.length - 1]).toISOString(),
      attempts,
    },
  };
}

/** Clears the circuit after a successful refresh (delta form: merge on write). */
export function successCircuitDelta() {
  return { refreshCircuit: null };
}

/**
 * Credential-persist payload for a successful refresh, shaped for
 * src/sse updateProviderCredentials: truthy credential fields only (a null RT
 * can never be written), with the stored providerSpecificData base preserved
 * and the circuit cleared. Pure so the clear-on-success contract is unit
 * testable without the DB graph.
 */
export function buildSuccessPersistPayload(baseProviderSpecificData, refreshed) {
  const base = baseProviderSpecificData || {};
  return {
    ...refreshed,
    existingProviderSpecificData: base,
    providerSpecificData: {
      ...base,
      ...(refreshed?.providerSpecificData || {}),
      ...successCircuitDelta(),
    },
  };
}

/** Sliding-window prune for the expired-token 3×/5min failure budget. */
export function pruneFailureWindow(timestamps, now = Date.now()) {
  return (timestamps || []).filter((ts) => now - ts < EXPIRED_BUDGET_WINDOW_MS);
}
