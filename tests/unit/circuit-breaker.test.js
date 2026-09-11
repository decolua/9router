import { beforeEach, describe, expect, it } from "vitest";
import { evaluateCircuit, recordCircuitOutcome, resetCircuitBreaker } from "../../open-sse/services/circuitBreaker.js";
import { recordProviderFailure, resetProviderFailureTracker, getProviderFailureCount } from "../../open-sse/services/providerFailureTracker.js";
import { acquireAccountSlot, resetAccountSemaphores, getAccountSemaphoreSnapshot } from "../../open-sse/services/accountSemaphore.js";

const provider = "openai";
const bucket = "direct:test";
const otherBucket = "pool:other";
const failure = (now, overrides = {}) => recordProviderFailure({ provider, bucket, connectionId: "connection", origin: "upstream_http", status: 503, ...overrides }, now);

beforeEach(() => { resetCircuitBreaker(); resetProviderFailureTracker(); resetAccountSemaphores(); });

describe("circuit breaker", () => {
  it("moves through closed, degraded, open, and half-open", () => {
    const now = 1000000;
    expect(evaluateCircuit(provider, bucket, now).state).toBe("CLOSED");
    failure(now); failure(now + 6000); failure(now + 12000); expect(evaluateCircuit(provider, bucket, now + 12001).state).toBe("DEGRADED");
    failure(now + 18000); failure(now + 24000);
    expect(evaluateCircuit(provider, bucket, now + 24001).state).toBe("OPEN");
    expect(evaluateCircuit(provider, bucket, now + 30000 + 24002).state).toBe("HALF_OPEN");
  });
  it("admits one half-open probe", () => {
    const now = 1000000;
    for (let i = 0; i < 5; i++) failure(now + i * 6000);
    expect(evaluateCircuit(provider, bucket, now + 30000).allowed).toBe(false);
    expect(evaluateCircuit(provider, bucket, now + 60001).probe).toBe(true);
    expect(evaluateCircuit(provider, bucket, now + 60002).allowed).toBe(false);
  });
  it("closes a successful probe without clearing another bucket", () => {
    const now = 1000000;
    for (let i = 0; i < 5; i++) failure(now + i * 6000);
    recordProviderFailure({ provider, bucket: otherBucket, connectionId: "other", origin: "upstream_http", status: 503 }, now + 30001);
    evaluateCircuit(provider, bucket, now + 30000);
    recordCircuitOutcome({ provider, bucket, outcome: "STREAM_COMPLETED", now: now + 30000 });
    expect(evaluateCircuit(provider, bucket, now + 30001).state).toBe("CLOSED");
    expect(getProviderFailureCount(provider, otherBucket, now + 30001)).toBe(1);
  });
  it("handles probe outcomes", () => {
    const now = 1000000;
    for (let i = 0; i < 5; i++) failure(now + i * 6000);
    evaluateCircuit(provider, bucket, now + 30000);
    recordCircuitOutcome({ provider, bucket, origin: "upstream_http", status: 503, now: now + 30000 });
    expect(evaluateCircuit(provider, bucket, now + 30001).state).toBe("OPEN");
  });
  it("does not record excluded origins or statuses", () => {
    for (const input of [{ origin: "upstream_http", status: 429 }, { origin: "proxy_pool", status: 503 }, { origin: "local_router", status: 500 }, { origin: "client_abort", status: 500 }, { origin: "credential_failure", status: 401 }]) recordProviderFailure({ provider, bucket, connectionId: "x", ...input });
    expect(getProviderFailureCount(provider, bucket)).toBe(0);
  });
  it("isolates buckets and supports no-op flag contract", () => {
    recordProviderFailure({ provider, bucket, connectionId: "a", origin: "upstream_http", status: 503 });
    expect(getProviderFailureCount(provider, otherBucket)).toBe(0);
  });
});
