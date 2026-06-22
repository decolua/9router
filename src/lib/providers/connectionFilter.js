/**
 * Provider connection filtering utilities.
 * Extracted from src/app/(dashboard)/dashboard/providers/page.js
 * to improve reusability and testability.
 */

import { getErrorCode, getRelativeTime } from "@/shared/utils";

/**
 * Calculate provider statistics from connections.
 *
 * @param {string} providerId - Provider identifier
 * @param {string|string[]} authType - Auth type(s) to include
 * @param {Array} connections - Array of connection objects
 * @returns {object} Stats object with connected, error, total, errorCode, errorTime, allDisabled
 */
export function getProviderStats(providerId, authType, connections) {
  const authTypes = Array.isArray(authType) ? authType : [authType];
  const providerConnections = connections.filter(
    (c) => c.provider === providerId && authTypes.includes(c.authType),
  );

  const getEffectiveStatus = (conn) => {
    const isCooldown = Object.entries(conn).some(
      ([k, v]) =>
        k.startsWith("modelLock_") && v && new Date(v).getTime() > Date.now(),
    );
    return conn.testStatus === "unavailable" && !isCooldown
      ? "active"
      : conn.testStatus;
  };

  const connected = providerConnections.filter((c) => {
    const status = getEffectiveStatus(c);
    return status === "active" || status === "success";
  }).length;

  const errorConns = providerConnections.filter((c) => {
    const status = getEffectiveStatus(c);
    return (
      status === "error" || status === "expired" || status === "unavailable"
    );
  });

  const error = errorConns.length;
  const total = providerConnections.length;
  const allDisabled =
    total > 0 && providerConnections.every((c) => c.isActive === false);

  const latestError = errorConns.sort(
    (a, b) => new Date(b.lastErrorAt || 0) - new Date(a.lastErrorAt || 0),
  )[0];

  // Extract error code from connection
  const getConnectionErrorTag = (connection) => {
    if (!connection) return null;

    const explicitType = connection.lastErrorType;
    if (explicitType === "runtime_error") return "RUNTIME";
    if (
      explicitType === "upstream_auth_error" ||
      explicitType === "auth_missing" ||
      explicitType === "token_refresh_failed" ||
      explicitType === "token_expired"
    )
      return "AUTH";
    if (explicitType === "upstream_rate_limited") return "429";
    if (explicitType === "upstream_unavailable") return "5XX";
    if (explicitType === "network_error") return "NET";

    const numericCode = Number(connection.errorCode);
    if (Number.isFinite(numericCode) && numericCode >= 400)
      return String(numericCode);

    // Fallback: parse from error message
    const fromMessage = getErrorCode(connection.lastError);
    if (fromMessage === "401" || fromMessage === "403") return "AUTH";
    if (fromMessage && fromMessage !== "ERR") return fromMessage;

    const msg = (connection.lastError || "").toLowerCase();
    if (
      msg.includes("runtime") ||
      msg.includes("not runnable") ||
      msg.includes("not installed")
    )
      return "RUNTIME";
    if (
      msg.includes("invalid api key") ||
      msg.includes("token invalid") ||
      msg.includes("revoked") ||
      msg.includes("unauthorized")
    )
      return "AUTH";

    return "ERR";
  };

  const errorCode = latestError ? getConnectionErrorTag(latestError) : null;

  const errorTime = latestError?.lastErrorAt
    ? getRelativeTime(latestError.lastErrorAt)
    : null;

  return { connected, error, total, errorCode, errorTime, allDisabled };
}

/**
 * Filter predicate: check if provider passes connection filter.
 * When connectedOnly is true, only providers with at least one connected
 * account/key are included.
 *
 * @param {string} providerId - Provider identifier
 * @param {string|string[]} authType - Auth type(s) to check
 * @param {boolean} connectedOnly - Whether to filter out providers with zero connections
 * @param {Array} connections - Array of connection objects
 * @returns {boolean} True if provider should be included
 */
export function passesConnectionFilter(
  providerId,
  authType,
  connectedOnly,
  connections,
) {
  if (!connectedOnly) return true;
  return getProviderStats(providerId, authType, connections).connected > 0;
}
