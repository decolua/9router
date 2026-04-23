import { beforeEach, describe, expect, it } from "vitest";

import {
  __hydrateProviderHotStateForTests,
  __getProviderHotStateSnapshotForTests,
  __resetProviderHotStateForTests,
  __setRedisClientForTests,
  deleteConnectionHotState,
  getEligibleConnectionIds,
  getEligibleConnections,
  getConnectionHotState,
  getConnectionHotStates,
  mergeConnectionsWithHotState,
  setConnectionHotState,
  writeConnectionHotState,
} from "../../src/lib/providerHotState.js";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("providerHotState", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
    __resetProviderHotStateForTests();
  });

  it("refreshes provider state from Redis instead of serving stale cached eligibility forever", async () => {
    process.env.REDIS_URL = "redis://example.test:6379";

    const redisState = {
      "conn-eligible": JSON.stringify({
        routingStatus: "eligible",
        testStatus: "active",
      }),
    };

    __setRedisClientForTests({
      isReady: true,
      hGetAll: async () => redisState,
    });

    expect(await getEligibleConnectionIds("provider-redis")).toEqual(["conn-eligible"]);

    redisState["conn-blocked"] = JSON.stringify({
      routingStatus: "blocked",
      authState: "invalid",
    });
    delete redisState["conn-eligible"];

    expect(await getEligibleConnectionIds("provider-redis")).toEqual([]);
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
      backoffLevel: 2,
      lastUsedAt: "2026-04-21T10:00:00.000Z",
      modelLock_gpt4: "2026-04-21T10:10:00.000Z",
    });
    expect(result.state).not.toHaveProperty("testStatus");
    expect(result.state).not.toHaveProperty("lastError");

    const snapshot = await getConnectionHotState("conn-1", "provider-a");
    expect(snapshot).toMatchObject({
      id: "conn-1",
      backoffLevel: 2,
      modelLock_gpt4: "2026-04-21T10:10:00.000Z",
      lastUsedAt: "2026-04-21T10:00:00.000Z",
    });
    expect(snapshot).not.toHaveProperty("testStatus");
    expect(snapshot).not.toHaveProperty("lastError");
  });

  it("projects centralized provider state without emitting legacy mirror fields", async () => {
    const retryAt = new Date(Date.now() + 60_000).toISOString();

    await setConnectionHotState("conn-blocked", "provider-b", {
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: retryAt,
    });

    await setConnectionHotState("conn-ready", "provider-b", {
      routingStatus: "eligible",
      authState: "ok",
      healthStatus: "healthy",
      quotaState: "ok",
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
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: retryAt,
    });
    expect(merged[0]).not.toHaveProperty("testStatus");
    expect(merged[0]).not.toHaveProperty("rateLimitedUntil");

    expect(merged[1]).toMatchObject({
      id: "conn-ready",
      routingStatus: "eligible",
      lastUsedAt: "2026-04-21T10:15:00.000Z",
    });
    expect(merged[1]).not.toHaveProperty("testStatus");

    expect(merged[2]).toMatchObject({
      id: "conn-unknown",
      provider: "provider-b",
      testStatus: "active",
    });

    const projected = await getConnectionHotStates([
      { id: "conn-blocked", provider: "provider-b", testStatus: "active" },
      { id: "conn-ready", provider: "provider-b", testStatus: "active" },
      { id: "conn-unknown", provider: "provider-b", testStatus: "active" },
    ]);

    expect(projected.get("conn-ready")).toMatchObject({ id: "conn-ready", routingStatus: "eligible" });
    expect(projected.get("conn-ready")).not.toHaveProperty("testStatus");

    expect(projected.get("conn-unknown")).toMatchObject({
      id: "conn-unknown",
      testStatus: "active",
    });
  });

  it("does not project another connection's blocked state onto untouched provider members", async () => {
    const retryAt = new Date(Date.now() + 60_000).toISOString();

    await setConnectionHotState("conn-blocked", "provider-h", {
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: retryAt,
    });

    const merged = await mergeConnectionsWithHotState([
      {
        id: "conn-blocked",
        provider: "provider-h",
        testStatus: "active",
      },
      {
        id: "conn-untouched",
        provider: "provider-h",
        testStatus: "active",
      },
    ]);

    expect(merged[0]).toMatchObject({
      id: "conn-blocked",
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: retryAt,
    });
    expect(merged[0]).not.toHaveProperty("testStatus");
    expect(merged[0]).not.toHaveProperty("rateLimitedUntil");
    expect(merged[1]).toMatchObject({
      id: "conn-untouched",
      testStatus: "active",
    });
  });

  it("keeps hot-state merges scoped by provider when connection IDs overlap", async () => {
    const retryAt = new Date(Date.now() + 60_000).toISOString();

    await setConnectionHotState("shared-conn", "provider-left", {
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: retryAt,
      reasonDetail: "left blocked",
    });

    await setConnectionHotState("shared-conn", "provider-right", {
      routingStatus: "eligible",
      authState: "ok",
      healthStatus: "healthy",
      quotaState: "ok",
      lastUsedAt: "2026-04-21T10:20:00.000Z",
    });

    const merged = await mergeConnectionsWithHotState([
      {
        id: "shared-conn",
        provider: "provider-left",
        testStatus: "active",
      },
      {
        id: "shared-conn",
        provider: "provider-right",
        testStatus: "active",
      },
    ]);

    expect(merged[0]).toMatchObject({
      id: "shared-conn",
      provider: "provider-left",
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: retryAt,
      reasonDetail: "left blocked",
    });
    expect(merged[0]).not.toHaveProperty("testStatus");
    expect(merged[0]).not.toHaveProperty("rateLimitedUntil");
    expect(merged[0]).not.toHaveProperty("lastError");
    expect(merged[1]).toMatchObject({
      id: "shared-conn",
      provider: "provider-right",
      routingStatus: "eligible",
      lastUsedAt: "2026-04-21T10:20:00.000Z",
    });
    expect(merged[1]).not.toHaveProperty("testStatus");

    const projected = await getConnectionHotStates([
      { id: "shared-conn", provider: "provider-left", testStatus: "active" },
      { id: "shared-conn", provider: "provider-right", testStatus: "active" },
    ]);

    expect(projected.get("provider-left:shared-conn")).toMatchObject({
      id: "shared-conn",
      provider: "provider-left",
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: retryAt,
      reasonDetail: "left blocked",
    });
    expect(projected.get("provider-left:shared-conn")).not.toHaveProperty("testStatus");
    expect(projected.get("provider-left:shared-conn")).not.toHaveProperty("lastError");
    expect(projected.get("provider-right:shared-conn")).toMatchObject({
      id: "shared-conn",
      provider: "provider-right",
      routingStatus: "eligible",
      lastUsedAt: "2026-04-21T10:20:00.000Z",
    });
    expect(projected.get("provider-right:shared-conn")).not.toHaveProperty("testStatus");
    expect(projected.has("shared-conn")).toBe(false);
  });

  it("keeps unscoped hot-state access for non-colliding connection IDs", async () => {
    await setConnectionHotState("unique-conn", "provider-solo", {
      routingStatus: "eligible",
      authState: "ok",
      healthStatus: "healthy",
      quotaState: "ok",
      lastUsedAt: "2026-04-21T11:00:00.000Z",
    });

    const projected = await getConnectionHotStates([
      { id: "unique-conn", provider: "provider-solo", testStatus: "unknown" },
    ]);

    expect(projected.get("provider-solo:unique-conn")).toMatchObject({
      id: "unique-conn",
      provider: "provider-solo",
      routingStatus: "eligible",
      lastUsedAt: "2026-04-21T11:00:00.000Z",
    });
    expect(projected.get("provider-solo:unique-conn")).not.toHaveProperty("testStatus");

    expect(projected.get("unique-conn")).toMatchObject({
      id: "unique-conn",
      provider: "provider-solo",
      routingStatus: "eligible",
      lastUsedAt: "2026-04-21T11:00:00.000Z",
    });
    expect(projected.get("unique-conn")).not.toHaveProperty("testStatus");
  });

  it("maintains eligible-account membership and retry indexes as connections change", async () => {
    const laterRetryAt = new Date(Date.now() + 120_000).toISOString();
    const earlierRetryAt = new Date(Date.now() + 30_000).toISOString();

    await setConnectionHotState("conn-a", "provider-c", {
      routingStatus: "eligible",
      testStatus: "active",
      lastUsedAt: "2026-04-21T10:00:00.000Z",
    });
    await setConnectionHotState("conn-b", "provider-c", {
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: laterRetryAt,
    });
    await setConnectionHotState("conn-c", "provider-c", {
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: earlierRetryAt,
    });

    expect(__getProviderHotStateSnapshotForTests("provider-c")).toMatchObject({
      eligibleConnectionIds: ["conn-a"],
      retryAt: earlierRetryAt,
    });

    await setConnectionHotState("conn-b", "provider-c", {
      routingStatus: "eligible",
      quotaState: "ok",
      nextRetryAt: null,
      reasonDetail: null,
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
      routingStatus: "eligible",
      testStatus: "active",
    });
    await setConnectionHotState("conn-blocked", "provider-d", {
      routingStatus: "exhausted",
      quotaState: "exhausted",
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

  it("keeps model-specific locks out of provider-wide eligibility indexes", async () => {
    const modelRetryAt = new Date(Date.now() + 45_000).toISOString();

    await setConnectionHotState("conn-model-locked", "provider-model-scoped", {
      routingStatus: "eligible",
      testStatus: "active",
      modelLock_gpt4: modelRetryAt,
    });

    expect(await getEligibleConnectionIds("provider-model-scoped")).toEqual(["conn-model-locked"]);
    expect(await getEligibleConnections("provider-model-scoped", [
      {
        id: "conn-model-locked",
        priority: 1,
        testStatus: "active",
      },
    ])).toEqual([
      {
        id: "conn-model-locked",
        priority: 1,
        testStatus: "active",
      },
    ]);

    expect(__getProviderHotStateSnapshotForTests("provider-model-scoped")).toMatchObject({
      eligibleConnectionIds: ["conn-model-locked"],
      retryAt: null,
      connections: {
        "conn-model-locked": {
          modelLock_gpt4: modelRetryAt,
        },
      },
    });
  });

  it("does not fallback-admit untouched healthy connections when provider hot state exists", async () => {
    const retryAt = new Date(Date.now() + 45_000).toISOString();

    await setConnectionHotState("conn-blocked", "provider-mixed", {
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: retryAt,
    });

    expect(await getEligibleConnections("provider-mixed", [
      { id: "conn-blocked", priority: 1 },
      { id: "conn-untouched", priority: 2, testStatus: "active" },
    ])).toEqual([]);
  });

  it("does not fallback-admit untouched unknown-status connections when provider hot state exists", async () => {
    const retryAt = new Date(Date.now() + 45_000).toISOString();

    await setConnectionHotState("conn-blocked", "provider-unknown", {
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: retryAt,
    });

    expect(await getEligibleConnections("provider-unknown", [
      { id: "conn-blocked", priority: 1, testStatus: "unknown" },
      { id: "conn-untouched", priority: 2, testStatus: "unknown" },
    ])).toEqual([]);
  });

  it("does not fallback-admit DB-only revoked accounts when their per-connection hot row is missing", async () => {
    await setConnectionHotState("conn-other", "provider-revoked-gap", {
      routingStatus: "eligible",
      authState: "ok",
      testStatus: "active",
    });

    expect(await getEligibleConnections("provider-revoked-gap", [
      {
        id: "conn-revoked",
        provider: "provider-revoked-gap",
        priority: 1,
        testStatus: "active",
        routingStatus: "blocked",
        authState: "revoked",
        lastError: "Token revoked",
      },
      {
        id: "conn-other",
        provider: "provider-revoked-gap",
        priority: 2,
        testStatus: "active",
      },
    ])).toEqual([
      {
        id: "conn-other",
        provider: "provider-revoked-gap",
        priority: 2,
        testStatus: "active",
      },
    ]);
  });

  it("excludes canonical unknown and exhausted routing statuses from eligibility indexes", async () => {
    await setConnectionHotState("conn-eligible", "provider-statuses", {
      routingStatus: "eligible",
      authState: "ok",
      quotaState: "ok",
      healthStatus: "healthy",
      testStatus: "active",
    });
    await setConnectionHotState("conn-unknown", "provider-statuses", {
      routingStatus: "unknown",
      testStatus: "active",
    });
    await setConnectionHotState("conn-exhausted", "provider-statuses", {
      routingStatus: "exhausted",
      quotaState: "exhausted",
      testStatus: "active",
    });

    expect(await getEligibleConnectionIds("provider-statuses")).toEqual(["conn-eligible"]);
    expect(await getEligibleConnections("provider-statuses", [
      { id: "conn-eligible", priority: 1 },
      { id: "conn-unknown", priority: 2 },
      { id: "conn-exhausted", priority: 3 },
    ])).toEqual([
      { id: "conn-eligible", priority: 1 },
    ]);
  });

  it("uses a tri-state eligibility contract for unavailable vs empty centralized state", async () => {
    expect(await getEligibleConnections("provider-missing", [
      { id: "conn-a", priority: 1, testStatus: "active" },
    ])).toBeNull();

    await setConnectionHotState("conn-blocked", "provider-empty", {
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: new Date(Date.now() + 45_000).toISOString(),
    });

    expect(await getEligibleConnections("provider-empty", [
      { id: "conn-blocked", priority: 1, testStatus: "active" },
    ])).toEqual([]);
  });

  it("excludes centrally blocked accounts from eligibility indexes even when legacy status is stale", async () => {
    await setConnectionHotState("conn-eligible", "provider-e", {
      routingStatus: "eligible",
      testStatus: "active",
    });
    await setConnectionHotState("conn-auth-blocked", "provider-e", {
      routingStatus: "blocked",
      authState: "invalid",
    });
    await setConnectionHotState("conn-health-blocked", "provider-e", {
      routingStatus: "blocked",
      healthStatus: "unhealthy",
    });
    await setConnectionHotState("conn-quota-blocked", "provider-e", {
      routingStatus: "exhausted",
      quotaState: "exhausted",
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
        routingStatus: "blocked",
        authState: "invalid",
      }),
      "conn-eligible": JSON.stringify({
        routingStatus: "eligible",
        testStatus: "active",
      }),
    });

    expect(await getEligibleConnectionIds("provider-f")).toEqual(["conn-eligible"]);
  });

  it("does not emit legacy mirror fields from read-time projection", async () => {
    await setConnectionHotState("conn-health", "provider-g", {
      routingStatus: "blocked",
      reasonCode: "upstream_unhealthy",
      reasonDetail: "Provider health check failed",
      nextRetryAt: "2026-04-21T12:30:00.000Z",
    });

    const snapshot = await getConnectionHotState("conn-health", "provider-g");
    expect(snapshot).toMatchObject({
      id: "conn-health",
      routingStatus: "blocked",
      reasonCode: "upstream_unhealthy",
      reasonDetail: "Provider health check failed",
      nextRetryAt: "2026-04-21T12:30:00.000Z",
    });
    expect(snapshot).not.toHaveProperty("testStatus");
    expect(snapshot).not.toHaveProperty("lastError");
    expect(snapshot).not.toHaveProperty("lastErrorType");
    expect(snapshot).not.toHaveProperty("lastErrorAt");
    expect(snapshot).not.toHaveProperty("rateLimitedUntil");
    expect(snapshot).not.toHaveProperty("errorCode");
    expect(snapshot).not.toHaveProperty("lastTested");
  });

  it("retains canonical blocked routing state without read-time legacy projection", async () => {
    await setConnectionHotState("conn-canonical-blocked", "provider-canonical-projection", {
      routingStatus: "blocked",
      reasonCode: "upstream_unhealthy",
      testStatus: "active",
      reasonDetail: "Provider health check failed",
    });

    const snapshot = await getConnectionHotState("conn-canonical-blocked", "provider-canonical-projection");
    expect(snapshot).toMatchObject({
      id: "conn-canonical-blocked",
      routingStatus: "blocked",
      reasonCode: "upstream_unhealthy",
      reasonDetail: "Provider health check failed",
    });
    expect(snapshot).not.toHaveProperty("testStatus");
    expect(snapshot).not.toHaveProperty("lastErrorType");
  });

  it("does not emit legacy mirror fields from active setConnectionHotState writes", async () => {
    const result = await setConnectionHotState("conn-no-legacy-set", "provider-no-legacy-set", {
      routingStatus: "eligible",
      healthStatus: "healthy",
      authState: "ok",
      quotaState: "ok",
      testStatus: "active",
      lastError: null,
      lastErrorType: null,
      lastErrorAt: null,
      rateLimitedUntil: null,
      errorCode: null,
      lastTested: "2026-04-21T12:00:00.000Z",
      lastCheckedAt: "2026-04-21T12:00:00.000Z",
    });

    expect(result.state).toMatchObject({
      routingStatus: "eligible",
      healthStatus: "healthy",
      authState: "ok",
      quotaState: "ok",
      lastCheckedAt: "2026-04-21T12:00:00.000Z",
    });

    expect(result.state).not.toHaveProperty("testStatus");
    expect(result.state).not.toHaveProperty("lastError");
    expect(result.state).not.toHaveProperty("lastErrorType");
    expect(result.state).not.toHaveProperty("lastErrorAt");
    expect(result.state).not.toHaveProperty("rateLimitedUntil");
    expect(result.state).not.toHaveProperty("errorCode");
    expect(result.state).not.toHaveProperty("lastTested");

    const readSnapshot = await getConnectionHotState("conn-no-legacy-set", "provider-no-legacy-set");
    expect(readSnapshot).toMatchObject({
      id: "conn-no-legacy-set",
      routingStatus: "eligible",
    });
    expect(readSnapshot).not.toHaveProperty("testStatus");
  });

  it("does not emit legacy mirror fields from active writeConnectionHotState writes", async () => {
    const snapshot = await writeConnectionHotState({
      connectionId: "conn-no-legacy-write",
      provider: "provider-no-legacy-write",
      patch: {
        routingStatus: "blocked",
        reasonCode: "auth_invalid",
        reasonDetail: "Token expired",
        testStatus: "expired",
        lastError: "Token expired",
        lastErrorType: "auth_invalid",
        lastErrorAt: "2026-04-21T12:30:00.000Z",
      },
    });

    expect(snapshot).toMatchObject({
      routingStatus: "blocked",
      reasonCode: "auth_invalid",
      reasonDetail: "Token expired",
    });
    expect(snapshot).not.toHaveProperty("testStatus");
    expect(snapshot).not.toHaveProperty("lastError");
    expect(snapshot).not.toHaveProperty("lastErrorType");
    expect(snapshot).not.toHaveProperty("lastErrorAt");

    const readSnapshot = await getConnectionHotState("conn-no-legacy-write", "provider-no-legacy-write");
    expect(readSnapshot).toMatchObject({
      id: "conn-no-legacy-write",
      routingStatus: "blocked",
      reasonCode: "auth_invalid",
      reasonDetail: "Token expired",
    });
    expect(readSnapshot).not.toHaveProperty("testStatus");

    const providerSnapshot = __getProviderHotStateSnapshotForTests("provider-no-legacy-write");
    expect(providerSnapshot?.connections?.["conn-no-legacy-write"]).toMatchObject({
      routingStatus: "blocked",
      reasonCode: "auth_invalid",
      reasonDetail: "Token expired",
    });
    expect(providerSnapshot?.connections?.["conn-no-legacy-write"]).not.toHaveProperty("testStatus");
    expect(providerSnapshot?.connections?.["conn-no-legacy-write"]).not.toHaveProperty("lastError");
    expect(providerSnapshot?.connections?.["conn-no-legacy-write"]).not.toHaveProperty("lastErrorType");
    expect(providerSnapshot?.connections?.["conn-no-legacy-write"]).not.toHaveProperty("lastErrorAt");
  });

  it("drops legacy top-level routing statuses on hot-state writes while keeping canonical details", async () => {
    const result = await setConnectionHotState("conn-legacy-routing", "provider-legacy-routing", {
      routingStatus: "blocked_auth",
      authState: "invalid",
      reasonCode: "auth_invalid",
      reasonDetail: "Token expired",
    });

    expect(result.state).toMatchObject({
      authState: "invalid",
      reasonCode: "auth_invalid",
    });
    expect(result.state).not.toHaveProperty("routingStatus");

    const snapshot = await getConnectionHotState("conn-legacy-routing", "provider-legacy-routing");
    expect(snapshot).toMatchObject({
      id: "conn-legacy-routing",
      authState: "invalid",
      reasonCode: "auth_invalid",
    });
    expect(snapshot).not.toHaveProperty("routingStatus");
  });

  it("treats quotaState=cooldown as non-blocking for eligibility indexes", async () => {
    await setConnectionHotState("conn-cooldown", "provider-cooldown", {
      routingStatus: "eligible",
      authState: "ok",
      healthStatus: "healthy",
      quotaState: "cooldown",
    });

    expect(await getEligibleConnectionIds("provider-cooldown")).toEqual(["conn-cooldown"]);
  });

  it("returns canonical exhausted routing state without legacy unavailable projection", async () => {
    await setConnectionHotState("conn-exhausted-projection", "provider-canonical", {
      routingStatus: "exhausted",
      quotaState: "exhausted",
      nextRetryAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const snapshot = await getConnectionHotState("conn-exhausted-projection", "provider-canonical");
    expect(snapshot).toMatchObject({
      id: "conn-exhausted-projection",
      routingStatus: "exhausted",
      quotaState: "exhausted",
    });
    expect(snapshot).not.toHaveProperty("testStatus");
  });

  it("returns canonical blocked auth_invalid state without legacy expired projection", async () => {
    await setConnectionHotState("conn-blocked-auth", "provider-canonical", {
      routingStatus: "blocked",
      reasonCode: "auth_invalid",
      reasonDetail: "Token expired",
    });

    const snapshot = await getConnectionHotState("conn-blocked-auth", "provider-canonical");
    expect(snapshot).toMatchObject({
      id: "conn-blocked-auth",
      routingStatus: "blocked",
      reasonCode: "auth_invalid",
      reasonDetail: "Token expired",
    });
    expect(snapshot).not.toHaveProperty("testStatus");
  });

  it("returns canonical blocked non-auth state without legacy error projection", async () => {
    await setConnectionHotState("conn-blocked-upstream", "provider-canonical", {
      routingStatus: "blocked",
      reasonCode: "upstream_unhealthy",
      reasonDetail: "Provider health check failed",
    });

    const snapshot = await getConnectionHotState("conn-blocked-upstream", "provider-canonical");
    expect(snapshot).toMatchObject({
      id: "conn-blocked-upstream",
      routingStatus: "blocked",
      reasonCode: "upstream_unhealthy",
      reasonDetail: "Provider health check failed",
    });
    expect(snapshot).not.toHaveProperty("testStatus");
  });

  it("preserves different-key updates when workers patch the same connection concurrently", async () => {
    process.env.REDIS_URL = "redis://example.test:6379";

    const redisHashes = new Map();
    const readsStarted = createDeferred();
    const allowWrites = createDeferred();
    let readCount = 0;

    __setRedisClientForTests({
      isReady: true,
      async hGetAll(key) {
        readCount += 1;
        if (readCount === 2) {
          readsStarted.resolve();
        }

        return { ...(redisHashes.get(key) || {}) };
      },
      async hSet(key, payload) {
        await allowWrites.promise;

        redisHashes.set(key, {
          ...(redisHashes.get(key) || {}),
          ...payload,
        });
      },
      async hDel(key, field) {
        const current = { ...(redisHashes.get(key) || {}) };
        delete current[field];
        redisHashes.set(key, current);
      },
      async expire() {
        return 1;
      },
    });

    const firstWrite = setConnectionHotState("conn-shared", "provider-shared", {
      routingStatus: "eligible",
      testStatus: "active",
      lastError: "worker-a",
    });

    const secondWrite = setConnectionHotState("conn-shared", "provider-shared", {
      backoffLevel: 3,
      lastErrorAt: "2026-04-21T10:30:00.000Z",
    });

    await readsStarted.promise;
    allowWrites.resolve();
    await Promise.all([firstWrite, secondWrite]);

    const snapshot = await getConnectionHotState("conn-shared", "provider-shared");
    expect(snapshot).toMatchObject({
      id: "conn-shared",
      backoffLevel: 3,
    });
    expect(snapshot).toHaveProperty("routingStatus", "eligible");
    expect(snapshot).not.toHaveProperty("testStatus");
    expect(snapshot).not.toHaveProperty("lastError");
    expect(snapshot).not.toHaveProperty("lastErrorAt");
  });

  it("hydrates mixed legacy and per-key Redis state deterministically with per-key values winning", async () => {
    process.env.REDIS_URL = "redis://example.test:6379";

    __setRedisClientForTests({
      isReady: true,
      async hGetAll() {
        return {
          "__conn__:conn-mixed:routingStatus": JSON.stringify("eligible"),
          "__conn__:conn-mixed:testStatus": JSON.stringify("active"),
          "__conn__:conn-mixed:lastError": JSON.stringify("new-format"),
          "__conn__:conn-mixed:lastErrorAt": JSON.stringify("2026-04-21T11:00:00.000Z"),
          "conn-mixed": JSON.stringify({
            testStatus: "unavailable",
            lastError: "legacy",
            backoffLevel: 1,
          }),
        };
      },
      async hSet() {
        return 1;
      },
      async hDel() {
        return 1;
      },
      async expire() {
        return 1;
      },
    });

    const snapshot = await getConnectionHotState("conn-mixed", "provider-mixed");
    expect(snapshot).toMatchObject({
      id: "conn-mixed",
      backoffLevel: 1,
    });
    expect(snapshot).toHaveProperty("routingStatus", "eligible");
    expect(snapshot).not.toHaveProperty("testStatus");
    expect(snapshot).not.toHaveProperty("lastError");
    expect(snapshot).not.toHaveProperty("lastErrorAt");
  });

  it("hydrates mixed legacy and per-key Redis state independent of field insertion order", async () => {
    const firstHydration = __hydrateProviderHotStateForTests("provider-order-a", {
      "__conn__:Y29ubjptaXhlZA==:cm91dGluZ1N0YXR1cw==": JSON.stringify("eligible"),
      "__conn__:Y29ubjptaXhlZA==:dGVzdFN0YXR1cw==": JSON.stringify("active"),
      "__conn__:Y29ubjptaXhlZA==:bGFzdEVycm9y": JSON.stringify("new-format"),
      "conn:mixed": JSON.stringify({
        testStatus: "unavailable",
        lastError: "legacy",
        backoffLevel: 1,
      }),
    });

    const secondHydration = __hydrateProviderHotStateForTests("provider-order-b", {
      "conn:mixed": JSON.stringify({
        testStatus: "unavailable",
        lastError: "legacy",
        backoffLevel: 1,
      }),
      "__conn__:Y29ubjptaXhlZA==:bGFzdEVycm9y": JSON.stringify("new-format"),
      "__conn__:Y29ubjptaXhlZA==:cm91dGluZ1N0YXR1cw==": JSON.stringify("eligible"),
      "__conn__:Y29ubjptaXhlZA==:dGVzdFN0YXR1cw==": JSON.stringify("active"),
    });

    expect(Object.fromEntries(firstHydration.connections.entries())).toEqual(
      Object.fromEntries(secondHydration.connections.entries()),
    );
    expect(__getProviderHotStateSnapshotForTests("provider-order-a")).toMatchObject({
      connections: {
        "conn:mixed": {
          backoffLevel: 1,
        },
      },
    });
    expect(__getProviderHotStateSnapshotForTests("provider-order-a")?.connections?.["conn:mixed"]).not.toHaveProperty("testStatus");
    expect(__getProviderHotStateSnapshotForTests("provider-order-a")?.connections?.["conn:mixed"]).not.toHaveProperty("lastError");
  });

  it("migrates legacy blob partial updates without dropping untouched fields", async () => {
    process.env.REDIS_URL = "redis://example.test:6379";

    const redisHashes = new Map([
      [
        "9router:provider-hot-state:provider-legacy-migration",
        {
          "conn-legacy": JSON.stringify({
            testStatus: "unavailable",
            lastError: "legacy failure",
            backoffLevel: 2,
          }),
        },
      ],
    ]);

    __setRedisClientForTests({
      isReady: true,
      async hGetAll(key) {
        return { ...(redisHashes.get(key) || {}) };
      },
      async hSet(key, payload) {
        redisHashes.set(key, {
          ...(redisHashes.get(key) || {}),
          ...payload,
        });
      },
      async hDel(key, field) {
        const current = { ...(redisHashes.get(key) || {}) };
        delete current[field];
        redisHashes.set(key, current);
      },
      async expire() {
        return 1;
      },
    });

    await setConnectionHotState("conn-legacy", "provider-legacy-migration", {
      lastUsedAt: "2026-04-21T12:30:00.000Z",
    });

    const snapshot = await getConnectionHotState("conn-legacy", "provider-legacy-migration");
    expect(snapshot).toMatchObject({
      id: "conn-legacy",
      backoffLevel: 2,
      lastUsedAt: "2026-04-21T12:30:00.000Z",
    });
    expect(snapshot).not.toHaveProperty("testStatus");
    expect(snapshot).not.toHaveProperty("lastError");

    const storedHash = redisHashes.get("9router:provider-hot-state:provider-legacy-migration");
    expect(storedHash).not.toHaveProperty("conn-legacy");
    expect(storedHash).not.toHaveProperty("__conn__:Y29ubi1sZWdhY3k=:dGVzdFN0YXR1cw==");
    expect(storedHash).not.toHaveProperty("__conn__:Y29ubi1sZWdhY3k=:bGFzdEVycm9y");
    expect(Object.values(storedHash || {})).not.toContain(JSON.stringify({
      testStatus: "unavailable",
      lastError: "legacy failure",
      backoffLevel: 2,
    }));
  });

  it("does not retain legacy mirror fields in Redis per-key storage on direct writes", async () => {
    process.env.REDIS_URL = "redis://example.test:6379";

    const redisKey = "9router:provider-hot-state:provider-direct-write";
    const redisHashes = new Map();

    __setRedisClientForTests({
      isReady: true,
      async hGetAll(key) {
        return { ...(redisHashes.get(key) || {}) };
      },
      async hSet(key, payload) {
        redisHashes.set(key, {
          ...(redisHashes.get(key) || {}),
          ...payload,
        });
      },
      async hDel(key, field) {
        const current = { ...(redisHashes.get(key) || {}) };
        delete current[field];
        redisHashes.set(key, current);
      },
      async expire() {
        return 1;
      },
    });

    await setConnectionHotState("conn-direct", "provider-direct-write", {
      routingStatus: "blocked",
      reasonCode: "auth_invalid",
      reasonDetail: "Token expired",
      testStatus: "expired",
      lastError: "Token expired",
      lastErrorType: "auth_invalid",
      lastErrorAt: "2026-04-21T12:30:00.000Z",
      rateLimitedUntil: "2026-04-21T12:35:00.000Z",
      errorCode: "E_AUTH",
      lastTested: "2026-04-21T12:30:00.000Z",
    });

    const storedHash = redisHashes.get(redisKey) || {};
    expect(storedHash).toHaveProperty("__conn__:Y29ubi1kaXJlY3Q=:cm91dGluZ1N0YXR1cw==", JSON.stringify("blocked"));
    expect(storedHash).toHaveProperty("__conn__:Y29ubi1kaXJlY3Q=:cmVhc29uQ29kZQ==", JSON.stringify("auth_invalid"));
    expect(storedHash).not.toHaveProperty("__conn__:Y29ubi1kaXJlY3Q=:dGVzdFN0YXR1cw==");
    expect(storedHash).not.toHaveProperty("__conn__:Y29ubi1kaXJlY3Q=:bGFzdEVycm9y");
    expect(storedHash).not.toHaveProperty("__conn__:Y29ubi1kaXJlY3Q=:bGFzdEVycm9yVHlwZQ==");
    expect(storedHash).not.toHaveProperty("__conn__:Y29ubi1kaXJlY3Q=:bGFzdEVycm9yQXQ=");
    expect(storedHash).not.toHaveProperty("__conn__:Y29ubi1kaXJlY3Q=:cmF0ZUxpbWl0ZWRVbnRpbA==");
    expect(storedHash).not.toHaveProperty("__conn__:Y29ubi1kaXJlY3Q=:ZXJyb3JDb2Rl");
    expect(storedHash).not.toHaveProperty("__conn__:Y29ubi1kaXJlY3Q=:bGFzdFRlc3RlZA==");

    const snapshot = await getConnectionHotState("conn-direct", "provider-direct-write");
    expect(snapshot).toMatchObject({
      id: "conn-direct",
      routingStatus: "blocked",
      reasonCode: "auth_invalid",
      reasonDetail: "Token expired",
    });
    expect(snapshot).not.toHaveProperty("testStatus");
    expect(snapshot).not.toHaveProperty("lastError");
    expect(snapshot).not.toHaveProperty("lastErrorType");
    expect(snapshot).not.toHaveProperty("lastErrorAt");
    expect(snapshot).not.toHaveProperty("rateLimitedUntil");
    expect(snapshot).not.toHaveProperty("errorCode");
    expect(snapshot).not.toHaveProperty("lastTested");
  });

  it("preserves concurrent partial updates during legacy-to-per-key migration", async () => {
    process.env.REDIS_URL = "redis://example.test:6379";

    const redisKey = "9router:provider-hot-state:provider-legacy-race";
    const redisHashes = new Map([
      [
        redisKey,
        {
          "conn-race": JSON.stringify({
            a: 0,
            b: 0,
          }),
        },
      ],
    ]);
    const readsStarted = createDeferred();
    const allowExec = createDeferred();
    let readCount = 0;
    let watchVersion = 0;

    __setRedisClientForTests({
      isReady: true,
      async watch() {
        const token = { version: watchVersion };
        this.__watchToken = token;
        return "OK";
      },
      async unwatch() {
        this.__watchToken = null;
        return "OK";
      },
      async hGetAll(key) {
        readCount += 1;
        if (readCount === 2) {
          readsStarted.resolve();
        }

        return { ...(redisHashes.get(key) || {}) };
      },
      multi() {
        const watchToken = this.__watchToken;
        const operations = [];

        return {
          hSet(key, payload) {
            operations.push({ type: "hSet", key, payload });
            return this;
          },
          hDel(key, field) {
            operations.push({ type: "hDel", key, field });
            return this;
          },
          expire(key, ttl) {
            operations.push({ type: "expire", key, ttl });
            return this;
          },
          async exec() {
            await allowExec.promise;

            if (!watchToken || watchToken.version !== watchVersion) {
              return null;
            }

            for (const operation of operations) {
              if (operation.type === "hSet") {
                redisHashes.set(operation.key, {
                  ...(redisHashes.get(operation.key) || {}),
                  ...operation.payload,
                });
              } else if (operation.type === "hDel") {
                const current = { ...(redisHashes.get(operation.key) || {}) };
                delete current[operation.field];
                redisHashes.set(operation.key, current);
              }
            }

            watchVersion += 1;
            return operations.map(() => "OK");
          },
        };
      },
      async expire() {
        return 1;
      },
    });

    const firstWrite = setConnectionHotState("conn-race", "provider-legacy-race", {
      a: 1,
    });
    const secondWrite = setConnectionHotState("conn-race", "provider-legacy-race", {
      b: 2,
    });

    await readsStarted.promise;
    allowExec.resolve();
    await Promise.all([firstWrite, secondWrite]);

    expect(await getConnectionHotState("conn-race", "provider-legacy-race")).toMatchObject({
      id: "conn-race",
      a: 1,
      b: 2,
    });

    const storedHash = redisHashes.get(redisKey);
    expect(storedHash).not.toHaveProperty("conn-race");
    expect(storedHash).toMatchObject({
      "__conn__:Y29ubi1yYWNl:YQ==": JSON.stringify(1),
      "__conn__:Y29ubi1yYWNl:Yg==": JSON.stringify(2),
    });
  });

  it("preserves Redis per-key hot-state updates when connection ids or state keys contain colons", async () => {
    process.env.REDIS_URL = "redis://example.test:6379";

    const redisHashes = new Map();

    __setRedisClientForTests({
      isReady: true,
      async hGetAll(key) {
        return { ...(redisHashes.get(key) || {}) };
      },
      async hSet(key, payload) {
        redisHashes.set(key, {
          ...(redisHashes.get(key) || {}),
          ...payload,
        });
      },
      async hDel(key, field) {
        const current = { ...(redisHashes.get(key) || {}) };
        delete current[field];
        redisHashes.set(key, current);
      },
      async expire() {
        return 1;
      },
    });

    await setConnectionHotState("conn:with:colon", "provider-colon", {
      "modelLock_model:alpha": "2026-04-21T12:00:00.000Z",
      reasonDetail: "colon-safe",
    });

    const snapshot = await getConnectionHotState("conn:with:colon", "provider-colon");
    expect(snapshot).toMatchObject({
      id: "conn:with:colon",
      "modelLock_model:alpha": "2026-04-21T12:00:00.000Z",
      reasonDetail: "colon-safe",
    });
    expect(snapshot).not.toHaveProperty("lastError");
  });

  it("preserves sibling connection updates when workers write the same provider concurrently", async () => {
    process.env.REDIS_URL = "redis://example.test:6379";

    const redisHashes = new Map();
    const readsStarted = createDeferred();
    const allowWrites = createDeferred();
    let readCount = 0;

    __setRedisClientForTests({
      isReady: true,
      async hGetAll(key) {
        readCount += 1;
        if (readCount === 2) {
          readsStarted.resolve();
        }

        return { ...(redisHashes.get(key) || {}) };
      },
      async del(key) {
        await allowWrites.promise;
        redisHashes.delete(key);
      },
      async hSet(key, payload) {
        await allowWrites.promise;

        if (payload["conn-b"]) {
          await Promise.resolve();
        }

        redisHashes.set(key, {
          ...(redisHashes.get(key) || {}),
          ...payload,
        });
      },
      async hDel(key, field) {
        const current = { ...(redisHashes.get(key) || {}) };
        delete current[field];
        redisHashes.set(key, current);
      },
      async expire() {
        return 1;
      },
    });

    const firstWrite = setConnectionHotState("conn-a", "provider-race", {
      routingStatus: "eligible",
      reasonDetail: "worker-a",
    });

    const secondWrite = setConnectionHotState("conn-b", "provider-race", {
      routingStatus: "eligible",
      reasonDetail: "worker-b",
    });

    await readsStarted.promise;
    allowWrites.resolve();
    await Promise.all([firstWrite, secondWrite]);

    const providerState = await getConnectionHotStates([
      { id: "conn-a", provider: "provider-race" },
      { id: "conn-b", provider: "provider-race" },
    ]);

    expect(providerState.get("provider-race:conn-a")).toMatchObject({
      id: "conn-a",
      reasonDetail: "worker-a",
    });
    expect(providerState.get("provider-race:conn-a")).not.toHaveProperty("lastError");

    expect(providerState.get("provider-race:conn-b")).toMatchObject({
      id: "conn-b",
      reasonDetail: "worker-b",
    });
    expect(providerState.get("provider-race:conn-b")).not.toHaveProperty("lastError");
  });
});
