import { describe, it, expect, beforeEach } from "vitest";
import { checkApiRateLimit, __test__ } from "../../src/lib/auth/apiRateLimiter.js";

describe("apiRateLimiter", () => {
  beforeEach(() => {
    // buckets are module-scoped; use unique keys per test
  });

  it("allows requests under the limit", () => {
    const ip = `test-ip-${Date.now()}`;
    const first = checkApiRateLimit({ ip });
    expect(first.allowed).toBe(true);
  });

  it("blocks when bucket is full", () => {
    const ip = `block-ip-${Date.now()}`;
    const { checkBucket, DEFAULT_IP_LIMIT } = __test__;
    const map = new Map();
    for (let i = 0; i < DEFAULT_IP_LIMIT; i += 1) {
      const r = checkBucket(map, ip, DEFAULT_IP_LIMIT);
      expect(r.allowed).toBe(true);
    }
    const blocked = checkBucket(map, ip, DEFAULT_IP_LIMIT);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
});
