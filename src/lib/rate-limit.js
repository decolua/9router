/**
 * Rate limiting middleware for 9Router API endpoints.
 * Implements token bucket algorithm with configurable limits per endpoint type.
 */

const rateLimitStore = new Map();
const DEFAULT_LIMITS = {
  chat: { requests: 100, windowMs: 60000 },      // 100 req/min
  embeddings: { requests: 200, windowMs: 60000 }, // 200 req/min
  models: { requests: 500, windowMs: 60000 },     // 500 req/min
  search: { requests: 30, windowMs: 60000 },      // 30 req/min
  default: { requests: 100, windowMs: 60000 },    // default 100 req/min
};

function getClientId(request) {
  // Use IP + User-Agent for client identification
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
  const ua = request.headers.get("user-agent") || "";
  return `${ip}:${ua.slice(0, 50)}`;
}

function getEndpointType(pathname) {
  if (pathname.includes("/v1/chat/completions")) return "chat";
  if (pathname.includes("/v1/embeddings")) return "embeddings";
  if (pathname.includes("/v1/models")) return "models";
  if (pathname.includes("/v1/search")) return "search";
  return "default";
}

export function rateLimit(request, customLimits = {}) {
  const clientId = getClientId(request);
  const endpointType = getEndpointType(new URL(request.url).pathname);
  const limits = { ...DEFAULT_LIMITS, ...customLimits };
  const limit = limits[endpointType] || limits.default;

  const now = Date.now();
  const key = `${clientId}:${endpointType}`;
  const bucket = rateLimitStore.get(key) || { count: 0, windowStart: now };

  // Reset window if expired
  if (now - bucket.windowStart >= limit.windowMs) {
    bucket.count = 0;
    bucket.windowStart = now;
  }

  bucket.count++;
  rateLimitStore.set(key, bucket);

  const remaining = Math.max(0, limit.requests - bucket.count);
  const resetTime = bucket.windowStart + limit.windowMs;
  const retryAfter = Math.ceil((resetTime - now) / 1000);

  const headers = {
    "X-RateLimit-Limit": String(limit.requests),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(Math.ceil(resetTime / 1000)),
  };

  if (bucket.count > limit.requests) {
    return {
      allowed: false,
      headers: {
        ...headers,
        "Retry-After": String(retryAfter),
      },
      retryAfter,
    };
  }

  return { allowed: true, headers };
}

// Periodic cleanup of old entries
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitStore.entries()) {
    if (now - bucket.windowStart > 300000) { // 5 minutes
      rateLimitStore.delete(key);
    }
  }
}, 60000);

export default rateLimit;