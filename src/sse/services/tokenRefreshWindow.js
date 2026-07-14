// Pure helper: decide whether a connection's access token is inside its
// proactive refresh-lead window. Extracted from the token refresh worker so
// it can be unit-tested without pulling in the DB / Next.js path aliases.
//
// We import via relative path (not the `open-sse/...` jsconfig alias) so
// `node --test` can resolve it without the bundler.

import { getRefreshLeadMs } from "../../../open-sse/services/tokenRefresh.js";
import { CONNECTION_STATUS } from "../../shared/constants/connectionStatus.js";

/**
 * @param {{ provider: string, refreshToken?: string, expiresAt?: string|number }} connection
 * @param {number} [now] - injectable clock for tests
 * @returns {boolean}
 */
export function shouldRefreshNow(connection, now = Date.now()) {
  if (!connection.refreshToken) return false;
  if (!connection.expiresAt) return false; // unknown TTL — let request path handle it
  const expiresAt = new Date(connection.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return false;
  const lead = getRefreshLeadMs(connection.provider);
  return expiresAt - now < lead;
}

/**
 * Worker-side gate: combines the lead-window check with the skip rules that
 * keep the worker from hammering revoked accounts. Kept as a pure function so
 * the worker `tick()` filter can be unit-tested without DB or scheduler.
 *
 * Skip when:
 *  - connection is flagged `needs_relogin` (refresh token is known-bad; only
 *    a successful re-login clears this state)
 *  - connection is disabled (`isActive === false`)
 *  - access token is not yet inside its provider lead window
 *
 * @param {{ provider: string, refreshToken?: string, expiresAt?: string|number,
 *           isActive?: boolean, testStatus?: string }} connection
 * @param {number} [now] - injectable clock for tests
 * @returns {boolean}
 */
export function shouldAttemptRefresh(connection, now = Date.now()) {
  if (!connection) return false;
  if (connection.isActive === false) return false;
  if (connection.testStatus === CONNECTION_STATUS.NEEDS_RELOGIN) return false;
  return shouldRefreshNow(connection, now);
}

/**
 * Detect session-only accounts (no refresh token) whose access token has
 * already expired. These need user action (re-import) rather than automatic
 * refresh, so the worker should mark them `needs_relogin`.
 *
 * @param {{ refreshToken?: string, expiresAt?: string|number,
 *           isActive?: boolean, testStatus?: string }} connection
 * @param {number} [now]
 * @returns {boolean}
 */
export function isExpiredSessionOnly(connection, now = Date.now()) {
  if (!connection) return false;
  if (connection.isActive === false) return false;
  if (connection.testStatus === CONNECTION_STATUS.NEEDS_RELOGIN) return false;
  if (connection.refreshToken) return false; // has refresh path — not session-only
  if (!connection.expiresAt) return false;   // unknown TTL — can't determine
  const expiresAt = new Date(connection.expiresAt).getTime();
  if (!Number.isFinite(expiresAt)) return false;
  return expiresAt <= now;
}

/**
 * Filter the candidate set the worker should attempt this tick.
 *
 * Pure wrapper around `shouldAttemptRefresh` so tests can assert the worker
 * dispatch list without spinning up a fake interval/DB.
 *
 * @param {Array<object>} connections
 * @param {number} [now]
 * @returns {Array<object>}
 */
export function selectConnectionsForRefresh(connections, now = Date.now()) {
  if (!Array.isArray(connections) || connections.length === 0) return [];
  return connections.filter((c) => shouldAttemptRefresh(c, now));
}
