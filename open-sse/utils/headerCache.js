// In-memory, per-connection cache for persistent custom header values.
// Values live for the process lifetime (permanent) or a TTL in minutes.
// Not durable — everything is lost on restart (by design).

const MAX_ENTRIES = 5000;
const store = new Map(); // cacheKey → { value, expiresAt }  (insertion-ordered)

export function getOrResolvePersistent(cacheKey, ttlMinutes, resolveFn, now = Date.now()) {
  const hit = store.get(cacheKey);
  if (hit && (hit.expiresAt === null || now < hit.expiresAt)) {
    return hit.value;
  }
  const value = resolveFn();
  const expiresAt = ttlMinutes > 0 ? now + ttlMinutes * 60000 : null;
  // Refresh insertion order: delete before set so re-inserts move to the end.
  store.delete(cacheKey);
  store.set(cacheKey, { value, expiresAt });
  // Bound growth: evict oldest (first inserted) entries beyond the cap.
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
  return value;
}

export function __clearHeaderCache() {
  store.clear();
}
