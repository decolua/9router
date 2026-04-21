import { beforeEach, describe, expect, it } from "vitest";

import {
  __hydrateProviderHotStateForTests,
  __getProviderHotStateSnapshotForTests,
  __resetProviderHotStateForTests,
  deleteConnectionHotState,
  getEligibleConnectionIds,
  getEligibleConnections,
  getConnectionHotState,
  getConnectionHotStates,
  mergeConnectionsWithHotState,
  setConnectionHotState,
} from "../../src/lib/providerHotState.js";

describe("providerHotState", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    __resetProviderHotStateForTests();
  });

  it("merges successive connection snapshots with latest hot-state precedence", async () => {
    await setConnectionHotState("conn-1", "provider-a", {
      testStatus: "unavailable",
      lastError: "first failure",
      backoffLevel: 1,
      modelLock_gpt4: "2026-04-21T10:10:00.000Z",
    });

    const result = await setConnectionHotState("conn-1", "provider-a", {
      lastError: "second failure",
      backoffLevel: 2,
      lastUsedAt: "2026-04-21T10:00:00.000Z",
    });

    expect(result.state).toMatchObject({
      testStatus: "unavailable",
      lastError: "second failure",
      backoffLevel: 2,
      lastUsedAt: "2026-04-21T10:00:00.000Z",
      modelLock_gpt4: "2026-04-21T10:10:00.000Z",
    });

    expect(await getConnectionHotState("conn-1", "provider-a")).toMatchObject({
      id: "conn-1",
      testStatus: "unavailable",
      lastError: "second failure",
      backoffLevel: 2,
      modelLock_gpt4: "2026-04-21T10:10:00.000Z",
    });
  });

  it("projects centralized provider state back onto legacy connection fields", async () => {
    const retryAt = new Date(Date.now() + 60_000).toISOString();

    await setConnectionHotState("conn-blocked", "provider-b", {
      rateLimitedUntil: retryAt,
    });

    await setConnectionHotState("conn-ready", "provider-b", {
      testStatus: "active",
      lastUsedAt: "2026-04-21T10:15:00.000Z",
    });

    const merged = await mergeConnectionsWithHotState([
      {
        id: "conn-blocked",
        provider: "provider-b",
        testStatus: "active",
        rateLimitedUntil: null,
      },
      {
        id: "conn-ready",
        provider: "provider-b",
        testStatus: "active",
      },
      {
        id: "conn-unknown",
        provider: "provider-b",
        testStatus: "active",
      },
    ]);

    expect(merged[0]).toMatchObject({
      id: "conn-blocked",
      testStatus: "unavailable",
      rateLimitedUntil: retryAt,
    });
    expect(merged[1]).toMatchObject({
      id: "conn-ready",
      testStatus: "active",
      lastUsedAt: "2026-04-21T10:15:00.000Z",
    });
    expect(merged[2]).toMatchObject({
      id: "conn-unknown",
      provider: "provider-b",
      testStatus: "unavailable",
      rateLimitedUntil: retryAt,
    });

    const projected = await getConnectionHotStates([
      { id: "conn-blocked", provider: "provider-b", testStatus: "active" },
      { id: "conn-ready", provider: "provider-b", testStatus: "active" },
      { id: "conn-unknown", provider: "provider-b", testStatus: "active" },
    ]);

    expect(projected.get("conn-ready")).toMatchObject({ id: "conn-ready", testStatus: "active" });
    expect(projected.get("conn-unknown")).toMatchObject({
      id: "conn-unknown",
      testStatus: "unavailable",
      rateLimitedUntil: retryAt,
    });
  });

  it("maintains eligible-account membership and retry indexes as connections change", async () => {
    const laterRetryAt = new Date(Date.now() + 120_000).toISOString();
    const earlierRetryAt = new Date(Date.now() + 30_000).toISOString();

    await setConnectionHotState("conn-a", "provider-c", {
      testStatus: "active",
      lastUsedAt: "2026-04-21T10:00:00.000Z",
    });
    await setConnectionHotState("conn-b", "provider-c", {
      testStatus: "unavailable",
      rateLimitedUntil: laterRetryAt,
    });
    await setConnectionHotState("conn-c", "provider-c", {
      testStatus: "unavailable",
      rateLimitedUntil: earlierRetryAt,
    });

    expect(__getProviderHotStateSnapshotForTests("provider-c")).toMatchObject({
      eligibleConnectionIds: ["conn-a"],
      retryAt: earlierRetryAt,
    });

    await setConnectionHotState("conn-b", "provider-c", {
      testStatus: "active",
      rateLimitedUntil: null,
      lastError: null,
    });

    expect(__getProviderHotStateSnapshotForTests("provider-c")).toMatchObject({
      eligibleConnectionIds: ["conn-a", "conn-b"],
      retryAt: earlierRetryAt,
    });

    await deleteConnectionHotState("conn-c", "provider-c");

    expect(__getProviderHotStateSnapshotForTests("provider-c")).toMatchObject({
      eligibleConnectionIds: ["conn-a", "conn-b"],
      retryAt: null,
    });
  });

  it("returns provider-side eligible connection helpers for router selection", async () => {
    const retryAt = new Date(Date.now() + 45_000).toISOString();

    await setConnectionHotState("conn-eligible", "provider-d", {
      testStatus: "active",
    });
    await setConnectionHotState("conn-blocked", "provider-d", {
      testStatus: "unavailable",
      rateLimitedUntil: retryAt,
    });

    expect(await getEligibleConnectionIds("provider-d")).toEqual(["conn-eligible"]);
    expect(await getEligibleConnections("provider-d", [
      { id: "conn-blocked", priority: 1 },
      { id: "conn-eligible", priority: 2 },
      { id: "conn-missing", priority: 3 },
    ])).toEqual([
      { id: "conn-eligible", priority: 2 },
    ]);
  });

  it("excludes centrally blocked accounts from eligibility indexes even when legacy status is stale", async () => {
    await setConnectionHotState("conn-eligible", "provider-e", {
      routingStatus: "eligible",
      testStatus: "active",
    });
    await setConnectionHotState("conn-auth-blocked", "provider-e", {
      routingStatus: "blocked_auth",
      testStatus: "active",
    });
    await setConnectionHotState("conn-health-blocked", "provider-e", {
      routingStatus: "blocked_health",
      testStatus: "active",
    });
    await setConnectionHotState("conn-quota-blocked", "provider-e", {
      routingStatus: "blocked_quota",
      quotaState: "exhausted",
      testStatus: "active",
    });

    expect(await getEligibleConnectionIds("provider-e")).toEqual(["conn-eligible"]);
    expect(await getEligibleConnections("provider-e", [
      { id: "conn-auth-blocked", priority: 1 },
      { id: "conn-health-blocked", priority: 2 },
      { id: "conn-quota-blocked", priority: 3 },
      { id: "conn-eligible", priority: 4 },
    ])).toEqual([
      { id: "conn-eligible", priority: 4 },
    ]);
  });

  it("recalculates eligibility indexes when hydrating stale provider meta", async () => {
    __hydrateProviderHotStateForTests("provider-f", {
      __provider_meta__: JSON.stringify({
        eligibleConnectionIds: ["conn-stale", "conn-eligible"],
        retryAt: null,
        updatedAt: "2026-04-21T10:00:00.000Z",
      }),
      "conn-stale": JSON.stringify({
        routingStatus: "blocked_auth",
        testStatus: "active",
      }),
      "conn-eligible": JSON.stringify({
        routingStatus: "eligible",
        testStatus: "active",
      }),
    });

    expect(await getEligibleConnectionIds("provider-f")).toEqual(["conn-eligible"]);
  });

  it("projects blocked health state back to legacy error fields", async () => {
    await setConnectionHotState("conn-health", "provider-g", {
      routingStatus: "blocked_health",
      reasonCode: "upstream_unhealthy",
      reasonDetail: "Provider health check failed",
    });

    expect(await getConnectionHotState("conn-health", "provider-g")).toMatchObject({
      id: "conn-health",
      testStatus: "error",
      lastError: "Provider health check failed",
      lastErrorType: "upstream_unhealthy",
    });
  });
});
