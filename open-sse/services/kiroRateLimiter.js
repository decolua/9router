/**
 * Pre-emptive token-bucket rate limiter for Kiro connections.
 *
 * Each Kiro connection is tracked by a `connectionId` and gets its own bucket
 * with configurable capacity and refill rate. Buckets are drained on every
 * outbound request and refilled continuously. When a bucket is empty, the
 * limiter denies the call locally (synthetic 429) instead of letting it hit
 * upstream, which keeps the Kiro account out of the longer
 * exponential-backoff cooldown that `accountFallback.js` applies on real 429s.
 *
 * On an upstream 429, the bucket is fully drained and a cooldown multiplier
 * (default 2x normal refill interval) is applied so the next token arrives
 * later than usual — backing off without bouncing the whole connection.
 *
 * Stale buckets (no activity for `STALE_TTL_MS`) are pruned by a periodic
 * sweep to avoid leaking memory across long-lived processes.
 *
 * Tunables (env):
 *   KIRO_RATE_LIMIT_CAPACITY        bucket capacity (default 10)
 *   KIRO_RATE_LIMIT_REFILL_PER_MIN  refill rate, tokens/min (default 3)
 *   KIRO_RATE_LIMIT_REFUND_ON_OK    refund a token on success (default off)
 *   KIRO_RATE_LIMIT_429_COOLDOWN_MULT  cooldown multiplier on upstream 429
 *                                     (default 2)
 */

const ONE_MINUTE_MS = 60 * 1000;
const STALE_TTL_MS = 30 * ONE_MINUTE_MS;
const SWEEP_INTERVAL_MS = 5 * ONE_MINUTE_MS;

function parseIntEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFloatEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

/**
 * Read tunables every time so tests can mutate `process.env` between calls.
 */
function readConfig() {
  const capacity = parseIntEnv("KIRO_RATE_LIMIT_CAPACITY", 10);
  const refillPerMin = parseFloatEnv("KIRO_RATE_LIMIT_REFILL_PER_MIN", 3);
  const refundOnOk = parseBoolEnv("KIRO_RATE_LIMIT_REFUND_ON_OK", false);
  const cooldownMult = parseFloatEnv("KIRO_RATE_LIMIT_429_COOLDOWN_MULT", 2);

  // refill interval: ms per single token
  const refillIntervalMs = ONE_MINUTE_MS / refillPerMin;

  return {
    capacity,
    refillPerMin,
    refillIntervalMs,
    refundOnOk,
    cooldownMult,
  };
}

const buckets = new Map();
let sweepTimer = null;

function ensureSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, b] of buckets) {
      if (now - b.lastTouchedAt > STALE_TTL_MS) {
        buckets.delete(id);
      }
    }
  }, SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

function getBucket(connectionId) {
  ensureSweep();
  const cfg = readConfig();
  let bucket = buckets.get(connectionId);
  if (!bucket) {
    bucket = {
      tokens: cfg.capacity,
      capacity: cfg.capacity,
      // ms per token. Mutates after a 429 (cooldown), back to nominal once
      // a token has been earned.
      refillIntervalMs: cfg.refillIntervalMs,
      nominalRefillIntervalMs: cfg.refillIntervalMs,
      lastRefillAt: Date.now(),
      lastTouchedAt: Date.now(),
      cooledDown: false,
    };
    buckets.set(connectionId, bucket);
    return bucket;
  }
  // Capacity may have changed (env mutated in tests / reload). Cap tokens.
  bucket.capacity = cfg.capacity;
  if (bucket.tokens > bucket.capacity) bucket.tokens = bucket.capacity;
  // Always track the latest nominal refill rate so we can restore from cooldown.
  bucket.nominalRefillIntervalMs = cfg.refillIntervalMs;
  if (!bucket.cooledDown) bucket.refillIntervalMs = cfg.refillIntervalMs;
  return bucket;
}

function refill(bucket, now = Date.now()) {
  if (bucket.tokens >= bucket.capacity) {
    bucket.lastRefillAt = now;
    return;
  }
  const elapsed = now - bucket.lastRefillAt;
  if (elapsed <= 0) return;
  const earned = Math.floor(elapsed / bucket.refillIntervalMs);
  if (earned <= 0) return;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + earned);
  bucket.lastRefillAt += earned * bucket.refillIntervalMs;
  // Once we earn at least one token after a cooldown, return to the nominal
  // refill rate. Cooldown is meant to delay the *next* token, not throttle
  // forever.
  if (bucket.cooledDown) {
    bucket.cooledDown = false;
    bucket.refillIntervalMs = bucket.nominalRefillIntervalMs;
  }
}

/**
 * Try to consume one token for `connectionId`.
 * @returns {{ allowed: boolean, retryAfterMs?: number, remaining?: number }}
 */
export function acquireToken(connectionId) {
  const id = String(connectionId || "default");
  const bucket = getBucket(id);
  const now = Date.now();
  bucket.lastTouchedAt = now;
  refill(bucket, now);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: bucket.tokens };
  }

  const elapsedSinceLastEarn = now - bucket.lastRefillAt;
  const retryAfterMs = Math.max(1, bucket.refillIntervalMs - elapsedSinceLastEarn);
  return { allowed: false, retryAfterMs, remaining: 0 };
}

/**
 * Optional success refund (off by default).
 * Useful when you want to be conservative on errors but lenient on success.
 */
export function reportSuccess(connectionId) {
  const id = String(connectionId || "default");
  const cfg = readConfig();
  if (!cfg.refundOnOk) return;
  const bucket = buckets.get(id);
  if (!bucket) return;
  bucket.lastTouchedAt = Date.now();
  if (bucket.tokens < bucket.capacity) bucket.tokens += 1;
}

/**
 * Drain the bucket and apply a cooldown multiplier so the next token takes
 * longer than usual. Used when upstream returns 429.
 */
export function reportRateLimit(connectionId) {
  const id = String(connectionId || "default");
  const bucket = getBucket(id);
  const now = Date.now();
  bucket.lastTouchedAt = now;

  const cfg = readConfig();
  bucket.tokens = 0;
  bucket.cooledDown = true;
  bucket.refillIntervalMs = cfg.refillIntervalMs * cfg.cooldownMult;
  // Restart the refill clock from now — next token earned in cooldown ms.
  bucket.lastRefillAt = now;
}

/**
 * Read-only snapshot for diagnostics / tests.
 */
export function getStatus(connectionId) {
  const id = String(connectionId || "default");
  const bucket = buckets.get(id);
  if (!bucket) return null;
  return {
    connectionId: id,
    tokens: bucket.tokens,
    capacity: bucket.capacity,
    refillIntervalMs: bucket.refillIntervalMs,
    nominalRefillIntervalMs: bucket.nominalRefillIntervalMs,
    cooledDown: bucket.cooledDown,
    lastRefillAt: bucket.lastRefillAt,
    lastTouchedAt: bucket.lastTouchedAt,
  };
}

/**
 * Test-only: clear all state and stop the sweep timer.
 * Not exported through any public surface; only consumed by the unit test.
 */
export function __resetForTests() {
  buckets.clear();
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/**
 * Test-only: trigger the stale-bucket sweep without waiting for the timer.
 */
export function __sweepStaleForTests(now = Date.now()) {
  for (const [id, b] of buckets) {
    if (now - b.lastTouchedAt > STALE_TTL_MS) {
      buckets.delete(id);
    }
  }
}

export const __internals = {
  ONE_MINUTE_MS,
  STALE_TTL_MS,
};
