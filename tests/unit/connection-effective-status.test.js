import { describe, expect, it } from "vitest";

import {
  getConnectionCentralizedStatus,
  getConnectionProviderCooldownUntil,
  getConnectionEffectiveStatus,
  getConnectionFilterStatus,
  getConnectionStatusBadgeMeta,
  getConnectionStatusDetails,
  normalizeConnectionFilterStatus,
} from "../../src/lib/connectionStatus.js";

describe("getConnectionEffectiveStatus", () => {
  it("keeps unavailable when rateLimitedUntil is still active without model locks", () => {
    const connection = {
      testStatus: "unavailable",
      rateLimitedUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };

    expect(getConnectionEffectiveStatus(connection)).toBe("unavailable");
  });

  it("returns active after unavailable cooldown has fully expired", () => {
    const connection = {
      testStatus: "unavailable",
      rateLimitedUntil: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    expect(getConnectionEffectiveStatus(connection)).toBe("active");
  });

  it("prefers centralized routing status over legacy test status", () => {
    const connection = {
      testStatus: "active",
      routingStatus: "blocked_quota",
      nextRetryAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };

    expect(getConnectionEffectiveStatus(connection)).toBe("unavailable");
  });

  it("maps centralized auth and health state to compatible UI statuses", () => {
    expect(getConnectionEffectiveStatus({ authState: "expired", testStatus: "active" })).toBe("expired");
    expect(getConnectionEffectiveStatus({ healthStatus: "failed", testStatus: "active" })).toBe("error");
  });

  it("does not let eligible routing status mask active blockers", () => {
    expect(getConnectionEffectiveStatus({ routingStatus: "eligible", authState: "expired", testStatus: "active" })).toBe("expired");
    expect(getConnectionEffectiveStatus({ routingStatus: "eligible", healthStatus: "failed", testStatus: "active" })).toBe("error");
    expect(getConnectionEffectiveStatus({ routingStatus: "eligible", quotaState: "cooldown", testStatus: "active" })).toBe("unavailable");
  });

  it("reports cooldown details from centralized retry fields and model locks", () => {
    const connection = {
      routingStatus: "cooldown",
      nextRetryAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      modelLock_gpt4: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    };

    const details = getConnectionStatusDetails(connection);

    expect(details.status).toBe("unavailable");
    expect(details.hasActiveModelLock).toBe(true);
    expect(details.activeModelLocks).toHaveLength(1);
    expect(details.cooldownUntil).toBe(connection.modelLock_gpt4);
  });

  it("tracks provider-wide cooldown separately from model locks", () => {
    const connection = {
      routingStatus: "cooldown",
      nextRetryAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      modelLock_gpt4: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    };

    expect(getConnectionProviderCooldownUntil(connection)).toBe(connection.nextRetryAt);
  });

  it("normalizes supported filter values and falls back invalid values to all", () => {
    expect(normalizeConnectionFilterStatus("active")).toBe("eligible");
    expect(normalizeConnectionFilterStatus("quota-exhausted")).toBe("blocked_quota");
    expect(normalizeConnectionFilterStatus("revoked-invalid")).toBe("blocked_auth");
    expect(normalizeConnectionFilterStatus("eligible")).toBe("eligible");
    expect(normalizeConnectionFilterStatus("blocked_quota")).toBe("blocked_quota");
    expect(normalizeConnectionFilterStatus("definitely-invalid")).toBe("all");
  });

  it("maps centralized and legacy connection states to centralized filter buckets", () => {
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible" })).toBe("eligible");
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible", authState: "expired" })).toBe("blocked_auth");
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible", healthStatus: "failed" })).toBe("blocked_health");
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible", quotaState: "cooldown" })).toBe("cooldown");
    expect(getConnectionCentralizedStatus({ quotaState: "cooldown" })).toBe("cooldown");
    expect(getConnectionCentralizedStatus({ quotaState: "exhausted" })).toBe("blocked_quota");
    expect(getConnectionCentralizedStatus({ authState: "invalid" })).toBe("blocked_auth");
    expect(getConnectionCentralizedStatus({ isActive: false, routingStatus: "eligible" })).toBe("disabled");
    expect(getConnectionCentralizedStatus({ testStatus: "active" })).toBe("eligible");
    expect(getConnectionCentralizedStatus({ testStatus: "unavailable", rateLimitedUntil: new Date(Date.now() + 10_000).toISOString() })).toBe("cooldown");
    expect(getConnectionCentralizedStatus({ quotaState: "exhausted", testStatus: "active" })).toBe("blocked_quota");
    expect(getConnectionCentralizedStatus({ testStatus: "unavailable" })).toBe("eligible");
  });

  it("collapses health failures into the auth-blocked filter bucket for current UI filters", () => {
    expect(getConnectionFilterStatus({ healthStatus: "failed" })).toBe("blocked_auth");
    expect(getConnectionFilterStatus({ routingStatus: "blocked_health" })).toBe("blocked_auth");
  });

  it("provides coherent badge labels and variants for centralized statuses", () => {
    expect(getConnectionStatusBadgeMeta({ routingStatus: "eligible" })).toEqual({
      status: "eligible",
      label: "Eligible",
      variant: "success",
    });
    expect(getConnectionStatusBadgeMeta({ routingStatus: "cooldown" })).toEqual({
      status: "cooldown",
      label: "Cooldown",
      variant: "warning",
    });
    expect(getConnectionStatusBadgeMeta({ authState: "expired" })).toEqual({
      status: "blocked_auth",
      label: "Auth blocked",
      variant: "error",
    });
    expect(getConnectionStatusBadgeMeta({ healthStatus: "failed" })).toEqual({
      status: "blocked_health",
      label: "Auth blocked",
      variant: "error",
    });
  });
});
