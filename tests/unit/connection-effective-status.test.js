import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns unknown when only legacy unavailable cooldown remains", () => {
    const connection = {
      testStatus: "unavailable",
      rateLimitedUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };

    expect(getConnectionEffectiveStatus(connection)).toBe("unknown");
  });

  it("returns unknown after legacy unavailable cooldown has fully expired", () => {
    const connection = {
      testStatus: "unavailable",
      rateLimitedUntil: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    expect(getConnectionEffectiveStatus(connection)).toBe("unknown");
  });

  it("prefers canonical routing status over legacy test status", () => {
    const connection = {
      testStatus: "active",
      routingStatus: "exhausted",
      nextRetryAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };

    expect(getConnectionEffectiveStatus(connection)).toBe("exhausted");
  });

  it("maps auth and health blockers to canonical blocked status", () => {
    expect(getConnectionEffectiveStatus({ authState: "expired", testStatus: "active" })).toBe("blocked");
    expect(getConnectionEffectiveStatus({ healthStatus: "failed", testStatus: "active" })).toBe("blocked");
  });

  it("does not let eligible routing status mask active blockers", () => {
    expect(getConnectionEffectiveStatus({ routingStatus: "eligible", authState: "expired", testStatus: "active" })).toBe("blocked");
    expect(getConnectionEffectiveStatus({ routingStatus: "eligible", healthStatus: "failed", testStatus: "active" })).toBe("blocked");
    expect(getConnectionEffectiveStatus({ routingStatus: "eligible", quotaState: "blocked", testStatus: "active" })).toBe("exhausted");
  });

  it("reports exhaustion details from retry fields and model locks", () => {
    const connection = {
      routingStatus: "exhausted",
      nextRetryAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      modelLock_gpt4: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    };

    const details = getConnectionStatusDetails(connection);

    expect(details.status).toBe("exhausted");
    expect(details.hasActiveModelLock).toBe(true);
    expect(details.activeModelLocks).toHaveLength(1);
    expect(details.cooldownUntil).toBe(connection.modelLock_gpt4);
  });

  it("uses the earliest active model lock when expired and active locks coexist", () => {
    const connection = {
      routingStatus: "exhausted",
      modelLock_expired: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      modelLock_gpt4: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
      modelLock_gpt4o: new Date(Date.now() + 6 * 60 * 1000).toISOString(),
    };

    const details = getConnectionStatusDetails(connection);

    expect(details.status).toBe("exhausted");
    expect(details.hasActiveModelLock).toBe(true);
    expect(details.activeModelLocks.map((lock) => lock.key)).toHaveLength(2);
    expect(details.activeModelLocks.map((lock) => lock.key)).toEqual(
      expect.arrayContaining(["modelLock_gpt4", "modelLock_gpt4o"]),
    );
    expect(details.cooldownUntil).toBe(connection.modelLock_gpt4);
  });

  it("tracks provider-wide cooldown separately from model locks", () => {
    const connection = {
      routingStatus: "exhausted",
      nextRetryAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      modelLock_gpt4: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    };

    expect(getConnectionProviderCooldownUntil(connection)).toBe(connection.nextRetryAt);
  });

  it("accepts only canonical filter values and falls back invalid values to all", () => {
    expect(normalizeConnectionFilterStatus("active")).toBe("all");
    expect(normalizeConnectionFilterStatus("quota-exhausted")).toBe("all");
    expect(normalizeConnectionFilterStatus("revoked-invalid")).toBe("all");
    expect(normalizeConnectionFilterStatus("eligible")).toBe("eligible");
    expect(normalizeConnectionFilterStatus("exhausted")).toBe("exhausted");
    expect(normalizeConnectionFilterStatus("blocked_health")).toBe("all");
    expect(normalizeConnectionFilterStatus("blocked_auth")).toBe("all");
    expect(normalizeConnectionFilterStatus("blocked_quota")).toBe("all");
    expect(normalizeConnectionFilterStatus("cooldown")).toBe("all");
    expect(normalizeConnectionFilterStatus("blocked")).toBe("blocked");
    expect(normalizeConnectionFilterStatus("definitely-invalid")).toBe("all");
  });

  it("maps connection states to canonical top-level statuses", () => {
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible" })).toBe("eligible");
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible", authState: "expired" })).toBe("blocked");
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible", healthStatus: "failed" })).toBe("blocked");
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible", quotaState: "blocked" })).toBe("exhausted");
    expect(getConnectionCentralizedStatus({ routingStatus: "eligible", quotaState: "exhausted" })).toBe("exhausted");
    expect(getConnectionCentralizedStatus({ quotaState: "blocked" })).toBe("exhausted");
    expect(getConnectionCentralizedStatus({ quotaState: "cooldown" })).toBe("unknown");
    expect(getConnectionCentralizedStatus({ quotaState: "exhausted" })).toBe("exhausted");
    expect(getConnectionCentralizedStatus({ authState: "invalid" })).toBe("blocked");
    expect(getConnectionCentralizedStatus({ isActive: false, routingStatus: "eligible" })).toBe("disabled");
    expect(getConnectionCentralizedStatus({ testStatus: "active" })).toBe("unknown");
    expect(getConnectionCentralizedStatus({ testStatus: "unavailable", rateLimitedUntil: new Date(Date.now() + 10_000).toISOString() })).toBe("unknown");
    expect(getConnectionCentralizedStatus({ quotaState: "exhausted", testStatus: "active" })).toBe("exhausted");
    expect(getConnectionCentralizedStatus({ testStatus: "unavailable" })).toBe("unknown");
  });

  it("keeps blocked and exhausted as distinct filter buckets", () => {
    expect(getConnectionFilterStatus({ authState: "expired" })).toBe("blocked");
    expect(getConnectionFilterStatus({ healthStatus: "failed" })).toBe("blocked");
    expect(getConnectionFilterStatus({ routingStatus: "exhausted" })).toBe("exhausted");
    expect(getConnectionFilterStatus({ routingStatus: "blocked" })).toBe("blocked");
  });

  it("preserves non-blocked filter buckets for eligible, disabled, and unknown states", () => {
    expect(getConnectionFilterStatus({ routingStatus: "eligible" })).toBe("eligible");
    expect(getConnectionFilterStatus({ isActive: false, routingStatus: "eligible" })).toBe("disabled");
    expect(getConnectionFilterStatus({})).toBe("unknown");
  });

  it("provides coherent badge labels and variants for canonical statuses", () => {
    expect(getConnectionStatusBadgeMeta({ routingStatus: "eligible" })).toEqual({
      status: "eligible",
      label: "Eligible",
      variant: "success",
    });
    expect(getConnectionStatusBadgeMeta({ routingStatus: "exhausted" })).toEqual({
      status: "exhausted",
      label: "Exhausted",
      variant: "warning",
    });
    expect(getConnectionStatusBadgeMeta({ authState: "expired" })).toEqual({
      status: "blocked",
      label: "Blocked",
      variant: "error",
    });
    expect(getConnectionStatusBadgeMeta({ healthStatus: "failed" })).toEqual({
      status: "blocked",
      label: "Blocked",
      variant: "error",
    });
    expect(getConnectionStatusBadgeMeta({ isActive: false, routingStatus: "eligible" })).toEqual({
      status: "disabled",
      label: "Disabled",
      variant: "default",
    });
    expect(getConnectionStatusBadgeMeta({})).toEqual({
      status: "unknown",
      label: "Unknown",
      variant: "default",
    });
  });
});
