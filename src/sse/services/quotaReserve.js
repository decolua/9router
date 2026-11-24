/**
 * Quota reserve — skip an account while its remaining quota in a window is at or below the share the
 * user keeps in reserve for it (`providerSpecificData.quotaReserve = { "5h": 20, "7d": 10 }`).
 *
 * Account selection runs under a mutex and must not wait on the network, so it reads an in-memory
 * snapshot of each account's windows. A stale or missing snapshot triggers a background refresh and,
 * meanwhile, never blocks the account. The dashboard's usage route also feeds fresh snapshots in.
 */

import { getUsageForProvider } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";
import { accountQuotaWindows, normalizeQuotaReserve } from "@/shared/constants/quotaWindows.js";
import * as log from "../utils/logger.js";

const SNAPSHOT_TTL_MS = 5 * 60_000; // re-read usage at most every 5 min per account
const FAILURE_BACKOFF_MS = 60_000;

// Survive Next.js hot reload: one cache per server process.
const g = (global.__quotaReserve ??= { snapshots: new Map(), inflight: new Map(), failedAt: new Map(), held: new Set() });

/** Store a usage snapshot ({ quotas }) for a connection. */
export function recordQuotaUsage(connectionId, quotas, now = Date.now()) {
  if (!connectionId || !quotas || typeof quotas !== "object") return;
  g.snapshots.set(connectionId, { windows: accountQuotaWindows(quotas), fetchedAt: now });
}

export function clearQuotaReserveCache() {
  g.snapshots.clear();
  g.inflight.clear();
  g.failedAt.clear();
  g.held.clear();
}

/**
 * The window currently holding this account back, or null when it may be used.
 * @returns {{ window: string, remaining: number, reserve: number, resetAt: string|null } | null}
 */
export function getQuotaReserveHold(connection, now = Date.now()) {
  const hold = findHold(connection, now);
  // Log transitions only, not every request while an account sits at its reserve.
  if (hold && !g.held.has(connection.id)) {
    g.held.add(connection.id);
    log.info("QUOTA_RESERVE", `${connection.id.slice(0, 8)} (${connection.name || connection.email || connection.provider}) held: ${hold.window} has ${Math.round(hold.remaining)}% left, reserve ${hold.reserve}%`);
  } else if (!hold && connection?.id && g.held.delete(connection.id)) {
    log.info("QUOTA_RESERVE", `${connection.id.slice(0, 8)} (${connection.name || connection.email || connection.provider}) back above its reserve`);
  }
  return hold;
}

function findHold(connection, now) {
  const reserve = normalizeQuotaReserve(connection?.providerSpecificData?.quotaReserve);
  if (!Object.keys(reserve).length) return null;

  const snapshot = g.snapshots.get(connection.id);
  if (!snapshot || now - snapshot.fetchedAt > SNAPSHOT_TTL_MS) refreshInBackground(connection, now);
  if (!snapshot) return null;

  for (const [windowId, keep] of Object.entries(reserve)) {
    const w = snapshot.windows[windowId];
    if (!w || w.remaining > keep) continue;
    const resetMs = w.resetAt ? new Date(w.resetAt).getTime() : NaN;
    if (Number.isFinite(resetMs) && resetMs <= now) continue; // window already reset; snapshot is stale
    return { window: windowId, remaining: w.remaining, reserve: keep, resetAt: w.resetAt };
  }
  return null;
}

function canReadUsage(connection) {
  if (connection.authType === "oauth") return true;
  const apikey = connection.authType === "apikey" || connection.authType === "api_key";
  return apikey && USAGE_APIKEY_PROVIDERS.includes(connection.provider);
}

function refreshInBackground(connection, now) {
  if (!connection?.id || g.inflight.has(connection.id) || !canReadUsage(connection)) return;
  const failedAt = g.failedAt.get(connection.id);
  if (failedAt && now - failedAt < FAILURE_BACKOFF_MS) return;

  const job = fetchUsage(connection)
    .then((quotas) => {
      if (quotas) recordQuotaUsage(connection.id, quotas);
      else g.failedAt.set(connection.id, Date.now());
    })
    .catch((error) => {
      g.failedAt.set(connection.id, Date.now());
      log.debug("QUOTA_RESERVE", `${connection.id.slice(0, 8)} | usage refresh failed: ${error.message}`);
    })
    .finally(() => g.inflight.delete(connection.id));
  g.inflight.set(connection.id, job);
}

async function fetchUsage(connection) {
  const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
  const proxyOptions = {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: false,
  };
  let current = connection;
  if (connection.authType === "oauth") {
    // Same refresh path as the dashboard usage route (re-reads the latest tokens before rotating).
    const { refreshAndUpdateCredentials } = await import("@/app/api/usage/[connectionId]/route.js");
    ({ connection: current } = await refreshAndUpdateCredentials(connection, false, proxyOptions));
  }
  const usage = await getUsageForProvider(current, proxyOptions);
  return usage?.quotas && Object.keys(usage.quotas).length ? usage.quotas : null;
}

/** Wait for in-flight refreshes (tests). */
export async function settleQuotaReserveRefreshes() {
  await Promise.allSettled([...g.inflight.values()]);
}
