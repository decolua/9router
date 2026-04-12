/**
 * In-memory store for quota reserve state per connection.
 * Uses global singleton to survive Next.js hot reloads.
 *
 * State shape per connection:
 * {
 *   quotaReserveBlocked: boolean,
 *   cooldownUntil: number | null,    // timestamp ms
 *   minRemainingPercent: number | null
 * }
 */

function getStateMap() {
  if (!global.__appSingleton) {
    global.__appSingleton = {};
  }
  if (!global.__appSingleton.quotaReserveState) {
    global.__appSingleton.quotaReserveState = new Map();
  }
  return global.__appSingleton.quotaReserveState;
}

export function getReserveState(connectionId) {
  return getStateMap().get(connectionId) || null;
}

export function setReserveState(connectionId, state) {
  const map = getStateMap();
  const current = map.get(connectionId) || {};
  map.set(connectionId, { ...current, ...state });
}

export function clearReserveState(connectionId) {
  getStateMap().delete(connectionId);
}

/**
 * Returns all reserve states as a plain object { connectionId: state }.
 */
export function getAllReserveStates() {
  const result = {};
  for (const [id, state] of getStateMap()) {
    result[id] = { ...state };
  }
  return result;
}

/**
 * Check if a connection is blocked by quota reserve or active cooldown.
 * Used by auth.js during account selection — must be fast (pure in-memory).
 */
export function isConnectionReserveBlocked(connectionId) {
  const state = getStateMap().get(connectionId);
  if (!state) return false;

  if (state.quotaReserveBlocked) return true;

  if (state.cooldownUntil && state.cooldownUntil > Date.now()) return true;

  return false;
}
