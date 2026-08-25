/**
 * MCP rate limiter.
 *
 * Combined sliding-window + token-bucket limiter. The sliding window enforces
 * the average request rate; the token bucket smooths bursts.
 *
 *   const { allowed, retryAfterMs } = checkRateLimit("mcp:message:1.2.3.4", {
 *     maxRequests: 60,
 *     windowMs: 60_000,
 *   });
 *   if (!allowed) return 429;
 *
 * State is kept on `globalThis` so it survives Next.js hot reloads in dev.
 */

const G_KEY = "__9routerMcpRateLimit";
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60_000;
const DEFAULT_ENTRY_TTL_MS = 5 * 60_000;

function getStore() {
  if (!globalThis[G_KEY]) {
    globalThis[G_KEY] = new Map();
  }
  return globalThis[G_KEY];
}

/**
 * Check if a request is allowed under the rate limit.
 *
 * @param {string} key
 * @param {object} [options]
 * @param {number} [options.maxRequests=60]   sliding-window ceiling
 * @param {number} [options.windowMs=60_000]  sliding-window duration
 * @param {number} [options.maxBurst]         token-bucket capacity (defaults to maxRequests)
 * @param {number} [options.refillRateMs]     token refill interval (defaults to windowMs/maxRequests)
 * @returns {{ allowed: boolean, remaining: number, resetMs: number, retryAfterMs: number }}
 */
export function checkRateLimit(key, options = {}) {
  const {
    maxRequests = 60,
    windowMs = 60_000,
    maxBurst = maxRequests,
    refillRateMs = Math.ceil(windowMs / maxRequests),
  } = options;

  const store = getStore();
  const now = Date.now();

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [], tokens: maxBurst, lastRefill: now };
    store.set(key, entry);
  }

  // Token-bucket refill.
  const elapsed = now - entry.lastRefill;
  if (elapsed >= refillRateMs) {
    const tokensToAdd = Math.floor(elapsed / refillRateMs);
    entry.tokens = Math.min(maxBurst, entry.tokens + tokensToAdd);
    entry.lastRefill = now;
  }

  // Sliding-window: prune stale timestamps.
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0];
    const resetMs = Math.max(0, oldest + windowMs - now);
    return { allowed: false, remaining: 0, resetMs, retryAfterMs: resetMs };
  }

  if (entry.tokens <= 0) {
    const resetMs = Math.max(0, refillRateMs - (now - entry.lastRefill));
    return { allowed: false, remaining: 0, resetMs, retryAfterMs: resetMs };
  }

  entry.timestamps.push(now);
  entry.tokens--;
  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    resetMs: windowMs,
    retryAfterMs: 0,
  };
}

/** Drop rate-limit entries with no activity for `maxAgeMs`. */
export function cleanupRateLimitEntries(maxAgeMs = DEFAULT_ENTRY_TTL_MS) {
  const store = getStore();
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    const lastActivity =
      entry.timestamps.length > 0
        ? entry.timestamps[entry.timestamps.length - 1]
        : entry.lastRefill;
    if (now - lastActivity > maxAgeMs) {
      store.delete(key);
    }
  }
}

// Auto-cleanup every 5 minutes; guard the interval so the process can exit.
if (typeof setInterval !== "undefined") {
  setInterval(() => cleanupRateLimitEntries(), DEFAULT_CLEANUP_INTERVAL_MS).unref?.();
}
