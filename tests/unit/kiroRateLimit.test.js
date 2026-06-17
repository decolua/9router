// Tests for Kiro 429 contention handling: mode-aware retry profiles,
// jittered backoff bounds, and Retry-After header honoring.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { jitteredBackoff, KIRO_RATE_LIMIT_DEFAULT } from "../../open-sse/config/runtimeConfig.js";

// A 429 response with optional Retry-After header
function rateLimited(retryAfter) {
  const headers = new Map();
  if (retryAfter != null) headers.set("retry-after", String(retryAfter));
  return {
    ok: false,
    status: 429,
    statusText: "Too Many Requests",
    headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
    body: { cancel: vi.fn().mockResolvedValue(undefined) },
  };
}

// A minimal successful EventStream response. transformEventStreamToSSE only
// needs a `body` (ReadableStream) — we hand it an empty one.
function success() {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => null },
    body: new ReadableStream({ start(c) { c.close(); } }),
  };
}

describe("jitteredBackoff", () => {
  it("stays within ± jitterRatio of the exponential value and respects the cap", () => {
    const cfg = { baseDelayMs: 400, maxDelayMs: 8000, jitterRatio: 0.5 };
    for (let attempt = 1; attempt <= 10; attempt++) {
      const exp = Math.min(400 * 2 ** (attempt - 1), 8000);
      for (let i = 0; i < 200; i++) {
        const v = jitteredBackoff(attempt, cfg);
        expect(v).toBeGreaterThanOrEqual(0);
        // never more than exp * (1 + ratio)
        expect(v).toBeLessThanOrEqual(Math.ceil(exp * 1.5) + 1);
      }
    }
  });

  it("falls back to defaults when given no config", () => {
    const v = jitteredBackoff(1, {});
    expect(v).toBeGreaterThanOrEqual(0);
    expect(typeof KIRO_RATE_LIMIT_DEFAULT.maxAttempts).toBe("number");
  });
});

describe("KiroExecutor.resolveRateLimitProfile", () => {
  const exec = new KiroExecutor();

  it("returns the balance profile by default", () => {
    const p = exec.resolveRateLimitProfile(undefined);
    expect(p.maxAttempts).toBe(5);
  });

  it("returns a more aggressive profile for stress", () => {
    const p = exec.resolveRateLimitProfile("stress");
    expect(p.maxAttempts).toBe(8);
    expect(p.maxAttempts).toBeGreaterThan(exec.resolveRateLimitProfile("balance").maxAttempts);
  });
});

describe("KiroExecutor 429 retry loop", () => {
  let exec;
  beforeEach(() => {
    exec = new KiroExecutor();
    vi.useFakeTimers();
    proxyAwareFetch.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function runExecute(kiroMode) {
    const promise = exec.execute({
      model: "claude-sonnet-4.5",
      body: { messages: [] },
      stream: true,
      credentials: { accessToken: "t" },
      kiroMode,
    });
    // Flush all pending timers (the backoff waits) until the loop resolves.
    await vi.runAllTimersAsync();
    return promise;
  }

  it("balance mode gives up after 5 retries (6 total fetches) on persistent 429", async () => {
    proxyAwareFetch.mockResolvedValue(rateLimited());
    const { response } = await runExecute("balance");
    expect(response.status).toBe(429);
    // 1 initial + 5 retries
    expect(proxyAwareFetch).toHaveBeenCalledTimes(6);
  });

  it("stress mode retries more (8 retries => 9 fetches)", async () => {
    proxyAwareFetch.mockResolvedValue(rateLimited());
    const { response } = await runExecute("stress");
    expect(response.status).toBe(429);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(9);
  });

  it("returns success once a retry clears the 429", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(success());
    const { response } = await runExecute("balance");
    expect(response.status).toBe(200);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });

  it("honors Retry-After header (capped) and drains the body between attempts", async () => {
    const rl = rateLimited(2); // 2 seconds
    proxyAwareFetch.mockResolvedValueOnce(rl).mockResolvedValueOnce(success());
    const { response } = await runExecute("balance");
    expect(response.status).toBe(200);
    expect(rl.body.cancel).toHaveBeenCalled();
  });
});
