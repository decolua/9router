import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getConnectionCentralizedStatus,
  getConnectionCooldownUntil,
  getConnectionProviderCooldownUntil,
  getConnectionStatusDetails,
  normalizeConnectionFilterStatus,
} from "../../src/lib/connectionStatus.js";

describe("connection status canonical read path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns unknown when only legacy testStatus=active is present", () => {
    const details = getConnectionStatusDetails({ testStatus: "active" });
    expect(getConnectionCentralizedStatus({ testStatus: "active" })).toBe("unknown");
    expect(details.status).toBe("unknown");
    expect(details.source).toBe("unknown");
  });

  it("returns unknown when legacy unavailable payload is present without canonical fields", () => {
    const details = getConnectionStatusDetails({
      testStatus: "unavailable",
      nextRetryAt: "2099-01-01T00:00:00.000Z",
    });
    expect(details.status).toBe("unknown");
    expect(details.source).toBe("unknown");
  });

  it("treats canonical quotaState=blocked as exhausted", () => {
    const details = getConnectionStatusDetails({ quotaState: "blocked" });
    expect(details.status).toBe("exhausted");
    expect(details.source).toBe("quotaState");
  });

  it("does not treat quotaState=cooldown as canonical", () => {
    expect(getConnectionCentralizedStatus({ quotaState: "cooldown" })).toBe("unknown");
  });

  it("does not map removed legacy filter aliases", () => {
    expect(normalizeConnectionFilterStatus("active")).toBe("all");
    expect(normalizeConnectionFilterStatus("blocked_auth")).toBe("all");
  });

  it("keeps canonical precedence for auth/health/quota over routing", () => {
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible", authState: "expired" })).toBe("blocked");
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible", healthStatus: "failed" })).toBe("blocked");
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible", quotaState: "blocked" })).toBe("exhausted");
  });

  it("uses canonical routingStatus when no stronger canonical blocker exists", () => {
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible" })).toBe("eligible");
    expect(getConnectionCentralizedStatus({ routingStatus: "blocked" })).toBe("blocked");
    expect(getConnectionCentralizedStatus({ routingStatus: "exhausted" })).toBe("exhausted");
    expect(getConnectionCentralizedStatus({ routingStatus: "unknown" })).toBe("unknown");
    expect(getConnectionCentralizedStatus({ routingStatus: "disabled" })).toBe("disabled");
  });

  it("ignores legacy rateLimitedUntil when deriving cooldown timestamps", () => {
    const connection = {
      rateLimitedUntil: "2099-04-25T00:00:00.000Z",
      nextRetryAt: "2099-04-24T00:00:00.000Z",
      resetAt: "2099-04-23T12:00:00.000Z",
      modelLock_gpt4: "2099-04-23T06:00:00.000Z",
    };

    expect(getConnectionProviderCooldownUntil(connection)).toBe("2099-04-23T12:00:00.000Z");
    expect(getConnectionCooldownUntil(connection)).toBe("2099-04-23T06:00:00.000Z");
  });

  it("returns null cooldown when only legacy rateLimitedUntil exists", () => {
    const connection = {
      rateLimitedUntil: "2099-04-25T00:00:00.000Z",
    };

    expect(getConnectionProviderCooldownUntil(connection)).toBeNull();
    expect(getConnectionCooldownUntil(connection)).toBeNull();
  });
});
