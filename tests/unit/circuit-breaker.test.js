import { describe, it, expect, beforeEach } from "vitest";
import {
  getCircuitBreaker,
  resetCircuitBreaker,
  resetAllCircuitBreakers,
  getAllCircuitBreakerStatuses,
  recordFailure,
  recordSuccess,
  canExecute,
  isBlocked,
  getRetryAfterMs,
  shouldRecordBreakerFailure,
  buildAccountBreakerName,
  STATE,
  PROVIDER_FAILURE_ERROR_CODES,
} from "../../open-sse/utils/circuitBreaker.js";

describe("CircuitBreaker", () => {
  beforeEach(() => {
    resetAllCircuitBreakers();
  });

  it("buildAccountBreakerName is provider:connectionId:model, and drops the model when absent", () => {
    expect(buildAccountBreakerName({ provider: "glm", connectionId: "acc-1", model: "glm-4" })).toBe("glm:acc-1:glm-4");
    expect(buildAccountBreakerName({ provider: "glm", connectionId: "acc-1" })).toBe("glm:acc-1");
  });

  it("starts CLOSED and can execute", () => {
    const cb = getCircuitBreaker("glm:a", { failureThreshold: 3, resetTimeout: 1000 });
    expect(cb.getStatus().state).toBe(STATE.CLOSED);
    expect(canExecute("glm:a")).toBe(true);
  });

  it("opens after reaching failure threshold", () => {
    const cb = getCircuitBreaker("glm:open", { failureThreshold: 3, resetTimeout: 1000 });
    recordFailure("glm:open", { statusCode: 500 });
    recordFailure("glm:open", { statusCode: 502 });
    expect(cb.getStatus().state).toBe(STATE.DEGRADED);
    recordFailure("glm:open", { statusCode: 503 });
    expect(cb.getStatus().state).toBe(STATE.OPEN);
    expect(canExecute("glm:open")).toBe(false);
  });

  it("does not count 429", () => {
    expect(PROVIDER_FAILURE_ERROR_CODES.has(429)).toBe(false);
    const cb = getCircuitBreaker("glm:rl", {
      failureThreshold: 1,
      isFailure: (err) => PROVIDER_FAILURE_ERROR_CODES.has(err?.statusCode),
    });
    recordFailure("glm:rl", { statusCode: 429 });
    expect(cb.getStatus().state).toBe(STATE.CLOSED);
    expect(canExecute("glm:rl")).toBe(true);
  });

  it("isolates accounts of the same provider", () => {
    getCircuitBreaker("glm:a", { failureThreshold: 1 });
    getCircuitBreaker("glm:b", { failureThreshold: 1 });
    recordFailure("glm:a", { statusCode: 500 });
    expect(canExecute("glm:a")).toBe(false);
    expect(canExecute("glm:b")).toBe(true);
  });

  it("HALF_OPEN probe success closes", async () => {
    getCircuitBreaker("glm:probe", { failureThreshold: 1, resetTimeout: 40 });
    recordFailure("glm:probe", { statusCode: 500 });
    await new Promise((r) => setTimeout(r, 50));
    expect(canExecute("glm:probe")).toBe(true);
    recordSuccess("glm:probe");
    expect(getCircuitBreaker("glm:probe").getStatus().state).toBe(STATE.CLOSED);
  });

  it("resetCircuitBreaker closes a single account", () => {
    getCircuitBreaker("glm:reset", { failureThreshold: 1 });
    recordFailure("glm:reset", { statusCode: 500 });
    resetCircuitBreaker("glm:reset");
    expect(canExecute("glm:reset")).toBe(true);
    expect(getCircuitBreaker("glm:reset").getStatus().state).toBe(STATE.CLOSED);
  });

  it("reset of one name does not close another", () => {
    getCircuitBreaker("glm:a", { failureThreshold: 1, isFailure: () => true });
    getCircuitBreaker("glm:b", { failureThreshold: 1, isFailure: () => true });
    recordFailure("glm:a", { statusCode: 500 });
    recordFailure("glm:b", { statusCode: 500 });
    resetCircuitBreaker("glm:a");
    expect(canExecute("glm:a")).toBe(true);
    expect(canExecute("glm:b")).toBe(false);
  });

  it("missing breaker is not blocked (fail-open)", () => {
    expect(isBlocked("glm:unknown")).toBe(false);
    expect(canExecute("glm:unknown")).toBe(true);
  });

  it("isBlocked does not consume the HALF_OPEN probe", async () => {
    getCircuitBreaker("glm:peek", { failureThreshold: 1, resetTimeout: 40, halfOpenRequests: 1 });
    recordFailure("glm:peek", { statusCode: 500 });
    expect(isBlocked("glm:peek")).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(isBlocked("glm:peek")).toBe(false);
    expect(getCircuitBreaker("glm:peek").getStatus().state).toBe(STATE.OPEN);
    expect(canExecute("glm:peek")).toBe(true);
    expect(getCircuitBreaker("glm:peek").getStatus().state).toBe(STATE.HALF_OPEN);
    expect(canExecute("glm:peek")).toBe(false);
  });

  it("getRetryAfterMs is 0 when CLOSED and positive when OPEN", () => {
    getCircuitBreaker("glm:retry", { failureThreshold: 1, resetTimeout: 10_000 });
    expect(getRetryAfterMs("glm:retry")).toBe(0);
    recordFailure("glm:retry", { statusCode: 500 });
    expect(getRetryAfterMs("glm:retry")).toBeGreaterThan(0);
  });

  it("shouldRecordBreakerFailure is 5xx/408 only", () => {
    expect(shouldRecordBreakerFailure(500)).toBe(true);
    expect(shouldRecordBreakerFailure(408)).toBe(true);
    expect(shouldRecordBreakerFailure(429)).toBe(false);
    expect(shouldRecordBreakerFailure(401)).toBe(false);
  });

  it("getAllCircuitBreakerStatuses lists registered names", () => {
    getCircuitBreaker("glm:a", { failureThreshold: 5 });
    getCircuitBreaker("glm:b", { failureThreshold: 5 });
    const names = getAllCircuitBreakerStatuses().map((s) => s.name);
    expect(names).toContain("glm:a");
    expect(names).toContain("glm:b");
  });
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("CircuitBreaker failure recency", () => {
  beforeEach(() => {
    resetAllCircuitBreakers();
  });

  it("counts failures in a rolling window, so old ones stop counting", async () => {
    // Without a window an account accumulated failures for the life of the
    // process: a handful of unrelated blips hours apart eventually tripped it.
    const cb = getCircuitBreaker("glm:win", { failureThreshold: 3, failureWindowMs: 60 });
    recordFailure("glm:win", { statusCode: 500 });
    recordFailure("glm:win", { statusCode: 500 });
    expect(cb.getStatus().state).toBe(STATE.DEGRADED);

    await sleep(80); // both failures age out
    recordFailure("glm:win", { statusCode: 500 });
    expect(cb.getStatus().state).not.toBe(STATE.OPEN);
    expect(cb.getStatus().failureCount).toBe(1);
  });

  it("reports failureCount from the window, not from a lifetime tally", async () => {
    const cb = getCircuitBreaker("glm:count", { failureThreshold: 10, failureWindowMs: 60 });
    recordFailure("glm:count", { statusCode: 500 });
    recordFailure("glm:count", { statusCode: 500 });
    expect(cb.getStatus().failureCount).toBe(2);
    await sleep(80);
    expect(cb.getStatus().failureCount).toBe(0);
  });

  it("does not re-open immediately after recovery from stale timestamps", async () => {
    // Recovery cleared the counter but left the timestamps behind, so with a
    // window enabled the first failure after recovery re-opened the breaker.
    const cb = getCircuitBreaker("glm:stale", {
      failureThreshold: 5,
      failureWindowMs: 10_000,
      resetTimeout: 40,
    });
    for (let i = 0; i < 5; i++) recordFailure("glm:stale", { statusCode: 500 });
    expect(cb.getStatus().state).toBe(STATE.OPEN);

    await sleep(50);
    expect(canExecute("glm:stale")).toBe(true); // HALF_OPEN probe
    recordSuccess("glm:stale");
    expect(cb.getStatus().state).toBe(STATE.CLOSED);

    recordFailure("glm:stale", { statusCode: 500 });
    expect(cb.getStatus().state).toBe(STATE.CLOSED);
    expect(cb.getStatus().failureCount).toBe(1);
  });

  it("requires successes earned since degrading, not a lifetime total", () => {
    // successCount was never reset on entering DEGRADED, so a busy account
    // closed on its very next success and DEGRADED meant nothing.
    const cb = getCircuitBreaker("glm:deg", { failureThreshold: 4, failureWindowMs: 10_000 });
    for (let i = 0; i < 50; i++) recordSuccess("glm:deg");
    recordFailure("glm:deg", { statusCode: 500 });
    recordFailure("glm:deg", { statusCode: 500 });
    expect(cb.getStatus().state).toBe(STATE.DEGRADED);

    recordSuccess("glm:deg");
    expect(cb.getStatus().state).toBe(STATE.DEGRADED);
    for (let i = 0; i < 3; i++) recordSuccess("glm:deg");
    expect(cb.getStatus().state).toBe(STATE.CLOSED);
  });

  it("recomputes the degradation threshold when failureThreshold is raised", () => {
    const cb = getCircuitBreaker("glm:thr", { failureThreshold: 5 });
    expect(cb.degradationThreshold).toBe(3);
    getCircuitBreaker("glm:thr", { failureThreshold: 20 });
    expect(cb.degradationThreshold).toBe(12);
  });

  it("keeps an explicit degradationThreshold when the threshold changes", () => {
    const cb = getCircuitBreaker("glm:thr2", { failureThreshold: 5, degradationThreshold: 2 });
    getCircuitBreaker("glm:thr2", { failureThreshold: 20 });
    expect(cb.degradationThreshold).toBe(2);
  });
});

describe("DEGRADED decays with its window", () => {
  // DEGRADED is a function of the window, not a latch. It used to need N
  // successes to clear, so an idle account that recovered on its own stayed
  // flagged in the dashboard with nothing left to justify it.
  beforeEach(() => {
    resetAllCircuitBreakers();
  });

  it("returns to CLOSED once the failures age out, with no successes at all", async () => {
    const cb = getCircuitBreaker("glm:decay", { failureThreshold: 5, failureWindowMs: 60 });
    recordFailure("glm:decay", { statusCode: 500 });
    recordFailure("glm:decay", { statusCode: 500 });
    recordFailure("glm:decay", { statusCode: 500 });
    expect(cb.getStatus().state).toBe(STATE.DEGRADED);

    await sleep(80);
    expect(cb.getStatus().state).toBe(STATE.CLOSED);
  });

  it("also settles when observed through canExecute", async () => {
    const cb = getCircuitBreaker("glm:decay2", { failureThreshold: 5, failureWindowMs: 60 });
    for (let i = 0; i < 3; i++) recordFailure("glm:decay2", { statusCode: 500 });
    expect(cb.getStatus().state).toBe(STATE.DEGRADED);

    await sleep(80);
    expect(canExecute("glm:decay2")).toBe(true);
    expect(cb.state).toBe(STATE.CLOSED);
  });

  it("keeps failures that are still inside the window when it settles", async () => {
    const cb = getCircuitBreaker("glm:decay3", { failureThreshold: 5, failureWindowMs: 120 });
    recordFailure("glm:decay3", { statusCode: 500 });
    recordFailure("glm:decay3", { statusCode: 500 });
    recordFailure("glm:decay3", { statusCode: 500 });
    expect(cb.getStatus().state).toBe(STATE.DEGRADED);

    await sleep(90); // the first three age out...
    recordFailure("glm:decay3", { statusCode: 500 }); // ...but this one is fresh
    await sleep(50);
    // Settling back to CLOSED must not discard a failure the window still holds.
    expect(cb.getStatus().state).toBe(STATE.CLOSED);
    expect(cb.getStatus().failureCount).toBe(1);
  });

  it("does not settle in cumulative mode, where nothing can decay", async () => {
    const cb = getCircuitBreaker("glm:nodecay", { failureThreshold: 5, failureWindowMs: 0 });
    for (let i = 0; i < 3; i++) recordFailure("glm:nodecay", { statusCode: 500 });
    expect(cb.getStatus().state).toBe(STATE.DEGRADED);
    await sleep(60);
    expect(cb.getStatus().state).toBe(STATE.DEGRADED);
  });

  it("leaves OPEN alone — only DEGRADED settles this way", async () => {
    const cb = getCircuitBreaker("glm:open-stays", {
      failureThreshold: 3,
      failureWindowMs: 60,
      resetTimeout: 10_000,
    });
    for (let i = 0; i < 3; i++) recordFailure("glm:open-stays", { statusCode: 500 });
    expect(cb.getStatus().state).toBe(STATE.OPEN);
    await sleep(80);
    expect(cb.getStatus().state).toBe(STATE.OPEN);
    expect(isBlocked("glm:open-stays")).toBe(true);
  });
});
