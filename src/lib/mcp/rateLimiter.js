/**
 * MCP Rate Limiter Middleware
 *
 * Adapted from MetaMCP's rate-limit.middleware.ts.
 * Implements a combined sliding window + token bucket rate limiter.
 *
 * Usage:
 *   const { checkRateLimit } = require('./rateLimiter');
 *   const allowed = checkRateLimit('mcp:message', { maxRequests: 60, windowMs: 60000 });
 *   if (!allowed) return 429;
 */

const G_KEY = "__9routerMcpRateLimit";

const getStore = () => {
  if (!globalThis[G_KEY]) {
    globalThis[G_KEY] = new Map(); // key -> { timestamps: number[], tokens: number, lastRefill: number }
  }
  return globalThis[G_KEY];
};

/**
 * Check if a request is allowed under the rate limit.
 *
 * @param {string} key - Rate limit bucket key (e.g., 'mcp:message:server123')
 * @param {object} options
 * @param {number} options.maxRequests - Max requests per window (sliding window)
 * @param {number} options.windowMs - Sliding window duration in ms
 * @param {number} [options.maxBurst] - Token bucket burst capacity (defaults to maxRequests)
 * @param {number} [options.refillRateMs] - Token refill interval in ms (defaults to windowMs / maxRequests)
 * @returns {{ allowed: boolean, remaining: number, resetMs: number, retryAfterMs: number }}
 */
function checkRateLimit(key, options = {}) {
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

  // ── Token bucket: refill ────────────────────────────────────────────────
  const elapsed = now - entry.lastRefill;
  if (elapsed >= refillRateMs) {
    const tokensToAdd = Math.floor(elapsed / refillRateMs);
    entry.tokens = Math.min(maxBurst, entry.tokens + tokensToAdd);
    entry.lastRefill = now;
  }

  // ── Sliding window: prune old timestamps ────────────────────────────────
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  // ── Decision ────────────────────────────────────────────────────────────
  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    const resetMs = oldestInWindow + windowMs - now;
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(0, resetMs),
      retryAfterMs: Math.max(0, resetMs),
    };
  }

  if (entry.tokens <= 0) {
    const resetMs = refillRateMs - (now - entry.lastRefill);
    return {
      allowed: false,
      remaining: 0,
      resetMs: Math.max(0, resetMs),
      retryAfterMs: Math.max(0, resetMs),
    };
  }

  // Allow request
  entry.timestamps.push(now);
  entry.tokens--;

  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    resetMs: windowMs,
    retryAfterMs: 0,
  };
}

/**
 * Clean up expired entries to prevent memory leaks.
 * Call periodically (e.g., every 5 minutes).
 */
function cleanupRateLimitEntries(maxAgeMs = 5 * 60_000) {
  const store = getStore();
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    const lastActivity = entry.timestamps.length > 0
      ? entry.timestamps[entry.timestamps.length - 1]
      : entry.lastRefill;
    if (now - lastActivity > maxAgeMs) {
      store.delete(key);
    }
  }
}

// Auto-cleanup every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => cleanupRateLimitEntries(), 5 * 60_000).unref?.();
}

module.exports = { checkRateLimit, cleanupRateLimitEntries };
