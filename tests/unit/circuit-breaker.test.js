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
