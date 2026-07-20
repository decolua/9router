import { createHash } from "node:crypto";

const REFRESH_RESULT_TTL_MS = 10_000;
const REFRESH_DEDUP_MAX_ENTRIES = 256;
const refreshDedupCache = new Map();
let refreshDedupCleanupTimer = null;

function refreshRouteContext(proxyOptions) {
  return JSON.stringify([
    proxyOptions?.disableEnvProxy === true,
    proxyOptions?.connectionProxyEnabled === true || proxyOptions?.enabled === true,
    String(proxyOptions?.connectionProxyUrl ?? proxyOptions?.url ?? ""),
    String(proxyOptions?.connectionNoProxy ?? proxyOptions?.noProxy ?? ""),
    String(proxyOptions?.vercelRelayUrl ?? ""),
    proxyOptions?.strictProxy === true,
    proxyOptions?.proxyUnavailable === true || proxyOptions?.source === "unavailable",
    String(proxyOptions?.proxyPoolId ?? proxyOptions?.connectionProxyPoolId ?? ""),
  ]);
}

function refreshDedupKey(provider, oldToken, proxyOptions) {
  const digest = createHash("sha256")
    .update(String(oldToken))
    .update("\0")
    .update(refreshRouteContext(proxyOptions))
    .digest("hex");
  return `${provider}:${digest}`;
}

function entryDeadline(entry) {
  return entry.promise ? Infinity : entry.expiresAt;
}

function pruneRefreshDedupCache(now = Date.now()) {
  for (const [key, entry] of refreshDedupCache) {
    if (entryDeadline(entry) <= now) refreshDedupCache.delete(key);
  }
}

function scheduleRefreshDedupCleanup() {
  if (refreshDedupCleanupTimer) clearTimeout(refreshDedupCleanupTimer);
  refreshDedupCleanupTimer = null;
  if (refreshDedupCache.size === 0) return;

  let deadline = Infinity;
  for (const entry of refreshDedupCache.values()) {
    deadline = Math.min(deadline, entryDeadline(entry));
  }
  if (!Number.isFinite(deadline)) return;
  refreshDedupCleanupTimer = setTimeout(() => {
    refreshDedupCleanupTimer = null;
    pruneRefreshDedupCache();
    scheduleRefreshDedupCleanup();
  }, Math.max(0, deadline - Date.now()));
  refreshDedupCleanupTimer.unref?.();
}

function makeRoomForRefresh() {
  for (const [key, entry] of refreshDedupCache) {
    if (refreshDedupCache.size < REFRESH_DEDUP_MAX_ENTRIES) break;
    if (!entry.promise) refreshDedupCache.delete(key);
  }
  return refreshDedupCache.size < REFRESH_DEDUP_MAX_ENTRIES;
}

export async function dedupRefresh(provider, oldToken, fn, log, proxyOptions = null) {
  if (!oldToken) return fn();

  const now = Date.now();
  pruneRefreshDedupCache(now);
  const key = refreshDedupKey(provider, oldToken, proxyOptions);
  const hit = refreshDedupCache.get(key);
  if (hit?.promise) {
    log?.info?.("TOKEN_REFRESH", `Reusing in-flight refresh for ${provider}`);
    scheduleRefreshDedupCleanup();
    return hit.promise;
  }
  if (hit) {
    log?.info?.("TOKEN_REFRESH", `Reusing recent refresh result for ${provider}`);
    scheduleRefreshDedupCleanup();
    return hit.result;
  }

  if (!makeRoomForRefresh()) {
    throw new Error("Refresh capacity reached; retry later");
  }
  const entry = { promise: null };
  const promise = Promise.resolve()
    .then(fn)
    .then((result) => {
      if (refreshDedupCache.get(key) !== entry) return result;
      refreshDedupCache.delete(key);
      if (result != null) {
        refreshDedupCache.set(key, {
          result,
          expiresAt: Date.now() + REFRESH_RESULT_TTL_MS,
        });
      }
      scheduleRefreshDedupCleanup();
      return result;
    }, (error) => {
      if (refreshDedupCache.get(key) === entry) refreshDedupCache.delete(key);
      scheduleRefreshDedupCleanup();
      throw error;
    });
  entry.promise = promise;
  refreshDedupCache.set(key, entry);
  scheduleRefreshDedupCleanup();
  return promise;
}
