// Sliding-window rate limiter for LLM API endpoints (/v1, /api/v1).

const DEFAULT_IP_LIMIT = Number(process.env.API_RATE_LIMIT_PER_MIN || 120);
const DEFAULT_KEY_LIMIT = Number(process.env.API_RATE_LIMIT_PER_KEY_PER_MIN || 300);
const WINDOW_MS = 60_000;

const ipBuckets = new Map();
const keyBuckets = new Map();

function pruneBucket(bucket, now) {
  while (bucket.length && now - bucket[0] > WINDOW_MS) bucket.shift();
}

function checkBucket(map, key, limit) {
  const now = Date.now();
  let bucket = map.get(key);
  if (!bucket) {
    bucket = [];
    map.set(key, bucket);
  }
  pruneBucket(bucket, now);
  if (bucket.length >= limit) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - bucket[0])) / 1000);
    return { allowed: false, retryAfter: Math.max(retryAfter, 1), remaining: 0 };
  }
  bucket.push(now);
  return { allowed: true, retryAfter: 0, remaining: Math.max(0, limit - bucket.length) };
}

export function checkApiRateLimit({ ip, apiKey } = {}) {
  const ipResult = checkBucket(ipBuckets, ip || "unknown", DEFAULT_IP_LIMIT);
  if (!ipResult.allowed) return { ...ipResult, scope: "ip" };

  if (apiKey) {
    const keyResult = checkBucket(keyBuckets, apiKey, DEFAULT_KEY_LIMIT);
    if (!keyResult.allowed) return { ...keyResult, scope: "api_key" };
    return { allowed: true, retryAfter: 0, remaining: keyResult.remaining, scope: "api_key" };
  }

  return { allowed: true, retryAfter: 0, remaining: ipResult.remaining, scope: "ip" };
}

export const __test__ = { checkBucket, WINDOW_MS, DEFAULT_IP_LIMIT, DEFAULT_KEY_LIMIT };
