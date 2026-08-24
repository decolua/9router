/**
 * Antigravity live quota cache — in-memory, refreshed on demand.
 * Used by auth.js pre-filter to skip accounts with exhausted model quota.
 * Also triggered by 409/429 error handler to sync exact resetAt from upstream.
 */

import { updateProviderConnection } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { getAntigravityUsage } from "open-sse/services/usage/google.js";
import { buildModelLockUpdate } from "open-sse/services/accountFallback.js";
import * as log from "../utils/logger.js";

// In-memory cache: connectionId → { [modelId]: { remainingPercentage, resetAt } }
const quotaCache = new Map();
// Track last refresh per connection to avoid hammering
const lastRefreshAt = new Map();
// In-flight refresh promises — dedup concurrent 409/429 bursts
const inflightRefresh = new Map();

const MIN_REFRESH_INTERVAL_MS = 30_000; // 30s between refreshes per connection

/**
 * Get the quota cache (read-only reference for auth.js pre-filter).
 */
export function getAntigravityQuotaCache() {
  return quotaCache;
}

/**
 * Refresh quota for all active Antigravity accounts before routing when cache is cold/stale.
 * Quota API returns all model buckets for one account in a single call.
 */
export async function refreshAntigravityQuotas(connections) {
  await Promise.all(connections.map((conn) => refreshAntigravityQuota(
    conn.id,
    conn.accessToken,
    { ...(conn.providerSpecificData || {}), ...(conn.projectId ? { projectId: conn.projectId } : {}) },
  )));
}

/**
 * Refresh quota for a single antigravity connection from upstream API.
 * Updates both in-memory cache and modelLock_* in DB when quota is exhausted.
 * @returns {object|null} quotas map or null on failure
 */
export async function refreshAntigravityQuota(connectionId, accessToken, providerSpecificData) {
  const now = Date.now();
  const lastRefresh = lastRefreshAt.get(connectionId) || 0;
  if (now - lastRefresh < MIN_REFRESH_INTERVAL_MS) {
    log.debug("AG_QUOTA", `${connectionId.slice(0, 8)} | skip refresh (${Math.round((now - lastRefresh) / 1000)}s ago)`);
    return quotaCache.get(connectionId) || null;
  }

  // Coalesce concurrent refreshes for same connection
  const inflight = inflightRefresh.get(connectionId);
  if (inflight) return inflight;

  const promise = _doRefresh(connectionId, accessToken, providerSpecificData, now);
  inflightRefresh.set(connectionId, promise);
  try {
    return await promise;
  } finally {
    inflightRefresh.delete(connectionId);
  }
}

async function _doRefresh(connectionId, accessToken, providerSpecificData, now) {
  try {
    const proxyCfg = await resolveConnectionProxyConfig(providerSpecificData || {});
    const proxyOptions = {
      connectionProxyEnabled: proxyCfg.connectionProxyEnabled === true,
      connectionProxyUrl: proxyCfg.connectionProxyUrl || "",
      connectionNoProxy: proxyCfg.connectionNoProxy || "",
      vercelRelayUrl: proxyCfg.vercelRelayUrl || "",
      strictProxy: false,
    };

    const usage = await getAntigravityUsage(accessToken, providerSpecificData, proxyOptions);
    if (!usage?.quotas) return null;

    // Update in-memory cache
    quotaCache.set(connectionId, usage.quotas);
    lastRefreshAt.set(connectionId, now);

    // Set modelLock_* for exhausted models so existing fallback chain also respects them
    const lockUpdates = {};
    for (const [modelId, quota] of Object.entries(usage.quotas)) {
      if (quota.remainingPercentage <= 0 && quota.resetAt) {
        const resetMs = new Date(quota.resetAt).getTime();
        if (resetMs > now) {
          const lockUpdate = buildModelLockUpdate(modelId, resetMs - now);
          Object.assign(lockUpdates, lockUpdate);
        }
      }
    }

    if (Object.keys(lockUpdates).length > 0) {
      await updateProviderConnection(connectionId, lockUpdates);
      log.info("AG_QUOTA", `${connectionId.slice(0, 8)} | locked ${Object.keys(lockUpdates).length} exhausted models to upstream resetAt`);
    }

    return usage.quotas;
  } catch (e) {
    log.warn("AG_QUOTA", `${connectionId.slice(0, 8)} | refresh failed: ${e.message}`);
    return null;
  }
}

/**
 * Handle antigravity 409/429 — trigger immediate quota refresh and set precise modelLock.
 * Called from chat handler error path.
 * @returns {number|null} resetAt timestamp ms (for resetsAtMs passthrough) or null
 */
export async function handleAntigravityQuotaError(connectionId, status, model, accessToken, providerSpecificData) {
  log.info("AG_QUOTA", `${connectionId.slice(0, 8)} | ${status} on ${model} — refreshing quota`);

  // Force refresh (bypass throttle for error-triggered refresh)
  lastRefreshAt.delete(connectionId);

  const quotas = await refreshAntigravityQuota(connectionId, accessToken, providerSpecificData);
  if (!quotas?.[model]?.resetAt) return null;

  const resetMs = new Date(quotas[model].resetAt).getTime();
  return resetMs > Date.now() ? resetMs : null;
}
