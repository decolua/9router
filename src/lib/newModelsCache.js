// Shared in-memory cache for the /api/models/new discovery result.
// Imported by both GET (uses it) and POST (clears it after acknowledge).
const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

const cache = { at: 0, data: null };

export function getCachedResult() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_TTL_MS) return cache.data;
  return null;
}

export function setCachedResult(data) {
  cache.at = Date.now();
  cache.data = data;
}

export function clearCache() {
  cache.at = 0;
  cache.data = null;
}
