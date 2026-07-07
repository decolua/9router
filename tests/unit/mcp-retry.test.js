// MCP-02: Bounded retry with exponential backoff and jitter.
// Tests the retry.js helper for transient failure handling.

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  retryWithBackoff,
  __test__,
} from "../../src/lib/mcp/gateway/retry";

const {
  calculateDelay,
  defaultIsTransient,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_BACKOFF_FACTOR,
} = __test__;

describe("retry — calculateDelay", () => {
  it("calculates exponential backoff: attempt 0 = base, 1 = base*2, 2 = base*4", () => {
    const delays = [0, 1, 2].map((a) =>
      calculateDelay(a, { baseDelayMs: 100, backoffFactor: 2, jitterRatio: 0 })
    );
    expect(delays[0]).toBe(100);
    expect(delays[1]).toBe(200);
    expect(delays[2]).toBe(400);
  });

  it("caps delay at maxDelayMs", () => {
    const delay = calculateDelay(10, {
      baseDelayMs: 100,
      backoffFactor: 2,
      maxDelayMs: 500,
      jitterRatio: 0,
    });
    // 100 * 2^10 = 102400, capped at 500.
    expect(delay).toBe(500);
  });

  it("applies jitter: delay varies within ±jitterRatio", () => {
    const samples = [];
    for (let i = 0; i < 20; i++) {
      samples.push(
        calculateDelay(1, { baseDelayMs: 100, backoffFactor: 2, jitterRatio: 0.25 })
      );
    }
    // Base delay is 200ms; jitter is ±25% = 150-250ms range.
    // At least some samples should differ (Math.random() variance).
    const unique = new Set(samples);
    expect(unique.size).toBeGreaterThan(1);
    // All samples should be in range [150, 250].
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(150);
      expect(s).toBeLessThanOrEqual(250);
    }
  });
});

describe("retry — defaultIsTransient", () => {
  it("returns false for McpAuthError", () => {
    const err = new Error("auth fail");
    err.name = "McpAuthError";
    expect(defaultIsTransient(err)).toBe(false);
  });

  it("returns false for 401, 403, 400, 404", () => {
    expect(defaultIsTransient({ status: 401, message: "unauthorized" })).toBe(false);
    expect(defaultIsTransient({ status: 403, message: "forbidden" })).toBe(false);
    expect(defaultIsTransient({ status: 400, message: "bad request" })).toBe(false);
    expect(defaultIsTransient({ status: 404, message: "not found" })).toBe(false);
  });

  it("returns true for timeout/network errors", () => {
    expect(defaultIsTransient({ message: "request timed out" })).toBe(true);
    expect(defaultIsTransient({ message: "network error" })).toBe(true);
    expect(defaultIsTransient({ code: "ECONNREFUSED" })).toBe(true);
    expect(defaultIsTransient({ code: "ECONNRESET" })).toBe(true);
    expect(defaultIsTransient({ code: "ETIMEDOUT" })).toBe(true);
  });

  it("returns true for 5xx and 429", () => {
    expect(defaultIsTransient({ status: 500 })).toBe(true);
    expect(defaultIsTransient({ status: 503 })).toBe(true);
    expect(defaultIsTransient({ status: 429 })).toBe(true);
  });

  it("returns false for unknown errors (conservative default)", () => {
    expect(defaultIsTransient({ message: "mysterious error" })).toBe(false);
    expect(defaultIsTransient({})).toBe(false);
  });
});

describe("retry — retryWithBackoff", () => {
  it("succeeds on first attempt without delay", async () => {
    const fn = vi.fn(async () => "ok");
    const result = await retryWithBackoff(fn, { maxAttempts: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient errors up to maxAttempts", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("timeout");
      return "ok";
    });
    const result = await retryWithBackoff(fn, {
      maxAttempts: 3,
      baseDelayMs: 10,
      jitterRatio: 0,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("stops retrying on non-transient errors", async () => {
    const fn = vi.fn(async () => {
      const err = new Error("auth fail");
      err.name = "McpAuthError";
      throw err;
    });
    await expect(retryWithBackoff(fn, { maxAttempts: 3 })).rejects.toThrow("auth fail");
    expect(fn).toHaveBeenCalledTimes(1); // No retries.
  });

  it("throws last error after exhausting maxAttempts", async () => {
    const fn = vi.fn(async () => {
      throw new Error("timeout");
    });
    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 2,
        baseDelayMs: 10,
        jitterRatio: 0,
      })
    ).rejects.toThrow("timeout");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("calls onRetry before each retry sleep", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new Error("timeout error");
      return "ok";
    });
    const onRetry = vi.fn();
    await retryWithBackoff(fn, {
      maxAttempts: 3,
      baseDelayMs: 10,
      jitterRatio: 0,
      onRetry,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({ message: "timeout error" }),
      0,
      10
    );
  });

  it("uses custom isTransient predicate", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      const err = new Error("custom error");
      err.code = "CUSTOM_RETRY";
      throw err;
    });
    const isTransient = (err) => err.code === "CUSTOM_RETRY";
    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 2,
        baseDelayMs: 10,
        jitterRatio: 0,
        isTransient,
      })
    ).rejects.toThrow("custom error");
    expect(fn).toHaveBeenCalledTimes(2); // Retried once.
  });
});
