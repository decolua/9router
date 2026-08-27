/**
 * Quota guard — pause an account when its remaining quota drops to/below a
 * per-account threshold so it keeps a safety buffer instead of hitting 0%.
 *
 * Design (see plan):
 *  - Per-account threshold is `connection.quotaPauseThreshold` (0/undefined = off).
 *  - The "remaining %" is known from a quota snapshot. Primary source is a
 *    snapshot persisted onto the connection (`lastQuotaSnapshot`) whenever the
 *    dashboard Quota Tracker / auto-ping fetches usage. On a cache miss we do a
 *    live fetch (timeout-wrapped) to refresh.
 *  - Paused state is derived, never persisted: once remaining% climbs back above
 *    the threshold (e.g. after resetAt) the account auto-recovers for routing.
 *  - Fail-open: if quota can't be determined (no data, ineligible provider, fetch
 *    error/timeout) the account is NEVER paused.
 */

import { getUsageForProvider } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { updateProviderConnection } from "@/lib/localDb";
import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";

// How long a snapshot (memory or persisted) stays fresh before a live refresh.
const CACHE_TTL_MS = 2 * 60 * 1000;
// Bound latency of an on-demand live fetch inside the routing path.
const LIVE_FETCH_TIMEOUT_MS = 3000;

// Module-level in-memory cache to avoid a live provider fetch on every request.
// key: connectionId -> { snapshot, fetchedAt }
const memoryCache = new Map();

function isEligible(connection) {
  if (!connection) return false;
  const isOAuth = connection.authType === "oauth";
  const isApikeyAuth =
    connection.authType === "apikey" || connection.authType === "api_key";
  const isApikeyEligible =
    isApikeyAuth && USAGE_APIKEY_PROVIDERS.includes(connection.provider);
  return isOAuth || isApikeyEligible;
}

function thresholdOf(connection) {
  const t = Number(connection?.quotaPauseThreshold);
  if (!Number.isFinite(t) || t <= 0 || t > 100) return 0;
  return t;
}

function freshSnapshot(snapshot, fetchedAt) {
  if (!snapshot || !fetchedAt) return null;
  const ts = typeof fetchedAt === "number" ? fetchedAt : new Date(fetchedAt).getTime();
  if (!Number.isFinite(ts)) return null;
  if (Date.now() - ts >= CACHE_TTL_MS) return null;
  return snapshot;
}

function readSnapshot(connection) {
  const cached = memoryCache.get(connection.id);
  if (cached) {
    const s = freshSnapshot(cached.snapshot, cached.fetchedAt);
    if (s) return s;
  }
  const persisted = connection.lastQuotaSnapshot;
  if (persisted) {
    const s = freshSnapshot(persisted, persisted.fetchedAt);
    if (s) return s;
  }
  return null;
}

function decidePaused(snapshot, threshold) {
  if (!snapshot) return false;
  if (snapshot.unlimited) return false;
  const remaining = Number(snapshot.remainingPercentage);
  if (!Number.isFinite(remaining)) return false;
  return remaining <= threshold;
}

function buildProxyOptions(connection) {
  // Reuse the same proxy resolution the usage API applies (strictProxy=false so
  // quota fetch falls back to direct on proxy failure).
  return resolveConnectionProxyConfig(connection.providerSpecificData || {}).then((proxyConfig) => ({
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: false,
  }));
}

async function fetchLiveSnapshot(connection) {
  const proxyOptions = await buildProxyOptions(connection);
  const usagePromise = getUsageForProvider(connection, proxyOptions, {});
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("quota fetch timeout")), LIVE_FETCH_TIMEOUT_MS)
  );
  const usage = await Promise.race([usagePromise, timeout]);
  if (!usage || usage.message || usage.error) return null;
  if (typeof usage.remainingPercentage !== "number") return null;
  return {
    remainingPercentage: usage.remainingPercentage,
    resetAt: usage.resetAt || null,
    unlimited: usage.unlimited === true,
    fetchedAt: new Date().toISOString(),
  };
}

function storeSnapshot(connectionId, snapshot) {
  memoryCache.set(connectionId, { snapshot, fetchedAt: Date.now() });
  // Best-effort persistence so the dashboard and subsequent routing reads stay warm.
  updateProviderConnection(connectionId, { lastQuotaSnapshot: snapshot }).catch(() => {});
}

/**
 * Decide whether an account should be skipped for routing due to low quota.
 * @param {Object} connection
 * @returns {Promise<{paused:boolean, reason:string, snapshot:Object|null}>}
 */
export async function evaluateQuota(connection) {
  const threshold = thresholdOf(connection);
  if (!threshold) return { paused: false, reason: "disabled", snapshot: null };
  if (!isEligible(connection)) return { paused: false, reason: "ineligible", snapshot: null };

  let snapshot = readSnapshot(connection);
  if (!snapshot) {
    try {
      snapshot = await fetchLiveSnapshot(connection);
    } catch {
      snapshot = null;
    }
    if (snapshot) storeSnapshot(connection.id, snapshot);
  }

  const paused = decidePaused(snapshot, threshold);
  return {
    paused,
    reason: paused ? "below-threshold" : snapshot ? "ok" : "no-data",
    snapshot,
  };
}

/**
 * Synchronous info for the dashboard UI (badge + threshold control).
 * Reads the persisted snapshot as-is (the Quota Tracker keeps it fresh).
 * @param {Object} connection
 * @returns {{enabled:boolean, paused:boolean, threshold:number, remainingPercentage:?number, resetAt:?string, unlimited:boolean}}
 */
export function getQuotaPauseInfo(connection) {
  const threshold = thresholdOf(connection);
  if (!threshold) {
    return { enabled: false, paused: false, threshold: 0, remainingPercentage: null, resetAt: null, unlimited: false };
  }
  const snapshot = connection.lastQuotaSnapshot || null;
  const remainingPercentage = snapshot ? Number(snapshot.remainingPercentage) : null;
  const paused = decidePaused(snapshot, threshold);
  return {
    enabled: true,
    paused,
    threshold,
    remainingPercentage: Number.isFinite(remainingPercentage) ? remainingPercentage : null,
    resetAt: snapshot?.resetAt || null,
    unlimited: Boolean(snapshot?.unlimited),
  };
}

// Exposed for tests / cache invalidation.
export function _clearQuotaCache(connectionId) {
  if (connectionId) memoryCache.delete(connectionId);
  else memoryCache.clear();
}
