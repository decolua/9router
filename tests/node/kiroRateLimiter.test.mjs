import { afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

const limiter = await import("../../open-sse/services/kiroRateLimiter.js");

const ORIGINAL_ENV = {
  KIRO_RATE_LIMIT_CAPACITY: process.env.KIRO_RATE_LIMIT_CAPACITY,
  KIRO_RATE_LIMIT_REFILL_PER_MIN: process.env.KIRO_RATE_LIMIT_REFILL_PER_MIN,
  KIRO_RATE_LIMIT_REFUND_ON_OK: process.env.KIRO_RATE_LIMIT_REFUND_ON_OK,
  KIRO_RATE_LIMIT_429_COOLDOWN_MULT: process.env.KIRO_RATE_LIMIT_429_COOLDOWN_MULT,
};

function resetEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  limiter.__resetForTests();
  mock.timers.enable({ apis: ["Date", "setInterval"], now: 0 });
  delete process.env.KIRO_RATE_LIMIT_CAPACITY;
  delete process.env.KIRO_RATE_LIMIT_REFILL_PER_MIN;
  delete process.env.KIRO_RATE_LIMIT_REFUND_ON_OK;
  delete process.env.KIRO_RATE_LIMIT_429_COOLDOWN_MULT;
});

afterEach(() => {
  limiter.__resetForTests();
  mock.timers.reset();
  resetEnv();
});

test("token acquisition depletes the per-connection bucket", () => {
  process.env.KIRO_RATE_LIMIT_CAPACITY = "2";
  process.env.KIRO_RATE_LIMIT_REFILL_PER_MIN = "60"; // one token/sec

  assert.deepEqual(limiter.acquireToken("conn-a"), { allowed: true, remaining: 1 });
  assert.deepEqual(limiter.acquireToken("conn-a"), { allowed: true, remaining: 0 });

  const denied = limiter.acquireToken("conn-a");
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.equal(denied.retryAfterMs, 1000);

  assert.equal(limiter.acquireToken("conn-b").allowed, true, "other connections have independent buckets");
});

test("refills over time", () => {
  process.env.KIRO_RATE_LIMIT_CAPACITY = "1";
  process.env.KIRO_RATE_LIMIT_REFILL_PER_MIN = "60";

  assert.equal(limiter.acquireToken("refill").allowed, true);
  assert.equal(limiter.acquireToken("refill").allowed, false);

  mock.timers.tick(999);
  assert.equal(limiter.acquireToken("refill").allowed, false);

  mock.timers.tick(1);
  assert.equal(limiter.acquireToken("refill").allowed, true);
});

test("success refund is configurable and defaults off", () => {
  process.env.KIRO_RATE_LIMIT_CAPACITY = "1";
  process.env.KIRO_RATE_LIMIT_REFILL_PER_MIN = "60";

  assert.equal(limiter.acquireToken("success").allowed, true);
  limiter.reportSuccess("success");
  assert.equal(limiter.acquireToken("success").allowed, false, "default does not refund");

  limiter.__resetForTests();
  process.env.KIRO_RATE_LIMIT_REFUND_ON_OK = "true";
  assert.equal(limiter.acquireToken("success").allowed, true);
  limiter.reportSuccess("success");
  assert.equal(limiter.acquireToken("success").allowed, true, "enabled refund restores one token");
});

test("rate limit report drains bucket and applies cooldown", () => {
  process.env.KIRO_RATE_LIMIT_CAPACITY = "3";
  process.env.KIRO_RATE_LIMIT_REFILL_PER_MIN = "60";

  assert.equal(limiter.acquireToken("upstream-429").allowed, true);
  limiter.reportRateLimit("upstream-429");

  const status = limiter.getStatus("upstream-429");
  assert.equal(status.tokens, 0);
  assert.equal(status.cooledDown, true);
  assert.equal(status.refillIntervalMs, 2000);

  mock.timers.tick(1000);
  assert.equal(limiter.acquireToken("upstream-429").allowed, false);

  mock.timers.tick(1000);
  assert.equal(limiter.acquireToken("upstream-429").allowed, true);
  assert.equal(limiter.getStatus("upstream-429").cooledDown, false);
});

test("stale cleanup removes inactive buckets", () => {
  assert.equal(limiter.acquireToken("stale").allowed, true);
  assert.ok(limiter.getStatus("stale"));

  limiter.__sweepStaleForTests(30 * 60 * 1000);
  assert.ok(limiter.getStatus("stale"));

  limiter.__sweepStaleForTests(30 * 60 * 1000 + 1);
  assert.equal(limiter.getStatus("stale"), null);
});

test("config is read from env vars", () => {
  process.env.KIRO_RATE_LIMIT_CAPACITY = "2";
  process.env.KIRO_RATE_LIMIT_REFILL_PER_MIN = "120"; // one token/500ms

  assert.equal(limiter.acquireToken("env").allowed, true);
  assert.equal(limiter.acquireToken("env").allowed, true);
  assert.equal(limiter.acquireToken("env").retryAfterMs, 500);

  mock.timers.tick(500);
  assert.equal(limiter.acquireToken("env").allowed, true);
});
