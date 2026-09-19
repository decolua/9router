const REFRESH_RESULT_TTL_MS = 10_000;
const refreshDedupCache = new Map();

export async function dedupRefresh(provider, oldToken, fn, log) {
  if (!oldToken) return fn();
  const key = `${provider}:${oldToken}`;
  const hit = refreshDedupCache.get(key);
  if (hit) {
    if (hit.promise) {
      log?.info?.("TOKEN_REFRESH", `Reusing in-flight refresh for ${provider}`);
      return hit.promise;
    }
    if (hit.expiresAt > Date.now()) {
      log?.info?.("TOKEN_REFRESH", `Reusing recent refresh result for ${provider}`);
      return hit.result;
    }
    refreshDedupCache.delete(key);
  }
  const promise = (async () => {
    try {
      const result = await fn();
      // F26/F-13: cache only real results (success, or a classified failure such
      // as invalid_grant — deterministic for that dead token). A `null` means
      // "failed for an unknown cause"; pinning it for the TTL window turns one
      // blip of the token endpoint into a 10s block on every refresh of that
      // credential (outage amplifier). In-flight dedup above is untouched.
      if (result) {
        refreshDedupCache.set(key, { result, expiresAt: Date.now() + REFRESH_RESULT_TTL_MS });
      } else {
        refreshDedupCache.delete(key);
      }
      return result;
    } catch (err) {
      refreshDedupCache.delete(key);
      throw err;
    }
  })();
  refreshDedupCache.set(key, { promise });
  return promise;
}
