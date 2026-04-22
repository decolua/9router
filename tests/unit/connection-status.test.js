import { describe, expect, it } from "vitest";

import {
  getConnectionCentralizedStatus,
  getConnectionCooldownUntil,
  getConnectionProviderCooldownUntil,
  getConnectionStatusDetails,
  normalizeConnectionFilterStatus,
} from "../../src/lib/connectionStatus.js";

describe("connection status canonical read path", () => {
  it("returns unknown when only legacy testStatus=active is present", () => {
    expect(getConnectionCentralizedStatus({ testStatus: "active" })).toBe("unknown");
  });

  it("retains legacy source metadata while remaining unknown status", () => {
    const details = getConnectionStatusDetails({ testStatus: "active" });
    expect(details.status).toBe("unknown");
    expect(details.source).toBe("legacy-testStatus");
  });

  it("still marks legacy unavailable with cooldown as exhausted in core details", () => {
    const details = getConnectionStatusDetails({
      testStatus: "unavailable",
      nextRetryAt: "2099-01-01T00:00:00.000Z",
    });
    expect(details.status).toBe("exhausted");
    expect(details.source).toBe("legacy-unavailable-cooldown");
  });

  it("treats legacy unavailable without cooldown as unknown in core details", () => {
    const details = getConnectionStatusDetails({
      testStatus: "unavailable",
    });
    expect(details.status).toBe("unknown");
    expect(details.source).toBe("legacy-unavailable-stale");
  });

  it("does not map removed legacy filter aliases", () => {
    expect(normalizeConnectionFilterStatus("active")).toBe("all");
    expect(normalizeConnectionFilterStatus("blocked_auth")).toBe("all");
  });

  it("keeps canonical precedence for auth/health/quota over routing", () => {
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible", authState: "expired" })).toBe("blocked");
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible", healthStatus: "failed" })).toBe("blocked");
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible", quotaState: "cooldown" })).toBe("exhausted");
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
      rateLimitedUntil: "2026-04-25T00:00:00.000Z",
      nextRetryAt: "2026-04-24T00:00:00.000Z",
      resetAt: "2026-04-23T12:00:00.000Z",
      modelLock_gpt4: "2026-04-23T06:00:00.000Z",
    };

    expect(getConnectionProviderCooldownUntil(connection)).toBe("2026-04-23T12:00:00.000Z");
    expect(getConnectionCooldownUntil(connection)).toBe("2026-04-23T06:00:00.000Z");
  });

  it("returns null cooldown when only legacy rateLimitedUntil exists", () => {
    const connection = {
      rateLimitedUntil: "2026-04-25T00:00:00.000Z",
    };

    expect(getConnectionProviderCooldownUntil(connection)).toBeNull();
    expect(getConnectionCooldownUntil(connection)).toBeNull();
  });
});
