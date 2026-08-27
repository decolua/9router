/**
 * Pure per-account quota-pause helpers shared by the routing engine
 * (src/sse/services/quotaGuard.js) and the dashboard UI. No DB/server imports
 * so this is safe to use in client components — it only reads plain fields that
 * already live on the connection object (quotaPauseThreshold, lastQuotaSnapshot).
 *
 * Paused state is derived, never stored: once remaining% climbs back above the
 * threshold (e.g. after resetAt) the account auto-recovers for routing.
 */

import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";

export function normalizeThreshold(connection) {
  const t = Number(connection?.quotaPauseThreshold);
  if (!Number.isFinite(t) || t <= 0 || t > 100) return 0;
  return t;
}

export function isQuotaEligible(connection) {
  if (!connection) return false;
  const isOAuth = connection.authType === "oauth";
  const isApikeyAuth =
    connection.authType === "apikey" || connection.authType === "api_key";
  const isApikeyEligible =
    isApikeyAuth && USAGE_APIKEY_PROVIDERS.includes(connection.provider);
  return isOAuth || isApikeyEligible;
}

export function isQuotaPaused(connection) {
  const threshold = normalizeThreshold(connection);
  if (!threshold) return false;
  if (!isQuotaEligible(connection)) return false;
  const snapshot = connection.lastQuotaSnapshot || null;
  if (!snapshot) return false;
  if (snapshot.unlimited) return false;
  const remaining = Number(snapshot.remainingPercentage);
  if (!Number.isFinite(remaining)) return false;
  return remaining <= threshold;
}

export function getQuotaPauseInfo(connection) {
  const threshold = normalizeThreshold(connection);
  if (!threshold) {
    return {
      enabled: false,
      paused: false,
      threshold: 0,
      remainingPercentage: null,
      resetAt: null,
      unlimited: false,
      eligible: isQuotaEligible(connection),
    };
  }
  const snapshot = connection.lastQuotaSnapshot || null;
  const remainingPercentage = snapshot ? Number(snapshot.remainingPercentage) : null;
  return {
    enabled: true,
    paused: isQuotaPaused(connection),
    threshold,
    remainingPercentage: Number.isFinite(remainingPercentage) ? remainingPercentage : null,
    resetAt: snapshot?.resetAt || null,
    unlimited: Boolean(snapshot?.unlimited),
    eligible: isQuotaEligible(connection),
  };
}
