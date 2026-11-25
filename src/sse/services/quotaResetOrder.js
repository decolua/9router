/**
 * "soonest-reset" account strategy: drain the account whose quota window resets
 * first, so its quota comes back first; the next account to reset is always next.
 *
 * Selection never waits on the network: it reads an in-memory quota snapshot and
 * kicks a background refresh when the snapshot is stale. Until the first snapshot
 * lands, accounts keep their priority order (same as fill-first).
 */

import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { getUsageForProvider } from "open-sse/services/usage.js";
import * as log from "../utils/logger.js";

const SNAPSHOT_TTL_MS = 5 * 60_000; // matches the Claude usage cache, so refreshes are mostly cache hits
const HOUR_MS = 3_600_000;

const snapshots = new Map(); // connectionId -> { quotas, fetchedAt }
const inflight = new Map(); // connectionId -> Promise

const resetMs = (q) => (q?.resetAt ? new Date(q.resetAt).getTime() : NaN);

/**
 * Pick the window that binds the account: the one resetting last (the long
 * window, e.g. weekly over a 5h session). Windows resetting within the same hour
 * are the same window seen per model; the one with less room left wins.
 */
export function bindingWindow(quotas, now = Date.now()) {
  const windows = Object.values(quotas || {}).filter((q) => q && !q.unlimited && resetMs(q) > now);
  let best = null;
  for (const q of windows) {
    if (!best) { best = q; continue; }
    const diff = resetMs(q) - resetMs(best);
    if (diff > HOUR_MS || (Math.abs(diff) <= HOUR_MS && q.remainingPercentage < best.remainingPercentage)) best = q;
  }
  return best;
}

/** Any window at 0% that has not reset yet blocks the account. */
export function isExhausted(quotas, now = Date.now()) {
  return Object.values(quotas || {}).some(
    (q) => q && !q.unlimited && Number(q.remainingPercentage) <= 0 && resetMs(q) > now,
  );
}

/**
 * Pure ordering. Exhausted accounts go last; then the soonest future reset
 * (same hour = tie); ties go to more free quota; unknown or past resets go after
 * every known future reset; priority breaks whatever is left.
 */
export function orderBySoonestReset(connections, quotasById, now = Date.now()) {
  const key = (c) => {
    const quotas = quotasById?.get?.(c.id) ?? quotasById?.[c.id];
    const win = bindingWindow(quotas, now);
    return {
      exhausted: isExhausted(quotas, now) ? 1 : 0,
      resetHour: win ? Math.round(resetMs(win) / HOUR_MS) : Infinity,
      free: win ? Number(win.remainingPercentage) : -1,
      priority: c.priority || 999,
    };
  };
  const keyed = connections.map((c) => ({ c, k: key(c) }));
  keyed.sort((a, b) =>
    a.k.exhausted - b.k.exhausted
    || (a.k.resetHour === b.k.resetHour ? 0 : a.k.resetHour < b.k.resetHour ? -1 : 1)
    || b.k.free - a.k.free
    || a.k.priority - b.k.priority);
  return keyed.map((x) => x.c);
}

async function refreshSnapshot(connection) {
  try {
    const proxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
    const usage = await getUsageForProvider(connection, {
      connectionProxyEnabled: proxy.connectionProxyEnabled === true,
      connectionProxyUrl: proxy.connectionProxyUrl || "",
      connectionNoProxy: proxy.connectionNoProxy || "",
      vercelRelayUrl: proxy.vercelRelayUrl || "",
      strictProxy: false,
    });
    // Soft failures ({message}) keep the previous snapshot instead of erasing it.
    if (usage?.quotas && !usage.message) snapshots.set(connection.id, { quotas: usage.quotas, fetchedAt: Date.now() });
  } catch (error) {
    log.warn("AUTH", `${connection.id?.slice(0, 8)} | quota refresh failed: ${error.message}`);
  }
}

/** Current snapshot (possibly stale or empty); refreshes stale entries in the background. */
export function getQuotaSnapshot(connections) {
  const now = Date.now();
  const quotasById = new Map();
  for (const c of connections) {
    const snap = snapshots.get(c.id);
    if (snap) quotasById.set(c.id, snap.quotas);
    if ((!snap || now - snap.fetchedAt > SNAPSHOT_TTL_MS) && !inflight.has(c.id)) {
      const p = refreshSnapshot(c).finally(() => inflight.delete(c.id));
      inflight.set(c.id, p);
    }
  }
  return quotasById;
}
