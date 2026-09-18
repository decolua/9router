/**
 * Background token refresh → Antigravity quota warm-up.
 *
 * After a successful background refresh of an antigravity connection, the
 * routing quota cache is warmed with the fresh token (opt-out via
 * AG_BG_QUOTA_WARMUP). Same pacing as the sequential refresh loop; warm-up
 * failures never break the loop (fail-open).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

const mocks = vi.hoisted(() => ({
  refreshAntigravityQuota: vi.fn(),
}));

vi.mock("../../src/sse/services/antigravityQuota.js", () => ({
  refreshAntigravityQuota: mocks.refreshAntigravityQuota,
}));

function conn(overrides = {}) {
  return {
    id: "c1",
    provider: "antigravity",
    authType: "oauth",
    refreshToken: "rt-1",
    expiresAt: new Date(NOW + 10 * 60 * 1000).toISOString(),
    isActive: true,
    providerSpecificData: {},
    ...overrides,
  };
}

async function importScheduler() {
  return import("../../src/sse/services/backgroundTokenRefresh.js");
}

describe("background quota warm-up", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.AG_BG_QUOTA_WARMUP;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.AG_BG_QUOTA_WARMUP;
  });

  it("warms the quota cache with the refreshed token for antigravity", async () => {
    mocks.refreshAntigravityQuota.mockResolvedValue({ claude_gpt_weekly: { remainingPercentage: 0 } });
    const refreshed = { accessToken: "fresh-token" };
    const refreshConnection = vi.fn(async () => refreshed);
    const loadConnections = vi.fn(async () => [conn({ id: "ag-1" })]);

    const { runBackgroundTokenRefreshTick } = await importScheduler();
    await runBackgroundTokenRefreshTick({ loadConnections, refreshConnection });

    expect(mocks.refreshAntigravityQuota).toHaveBeenCalledTimes(1);
    expect(mocks.refreshAntigravityQuota).toHaveBeenCalledWith("ag-1", "fresh-token", {});
  });

  it("does not warm the cache for non-antigravity providers", async () => {
    const refreshConnection = vi.fn(async (c) => c);
    const loadConnections = vi.fn(async () => [conn({ id: "g-1", provider: "grok-cli" })]);

    const { runBackgroundTokenRefreshTick } = await importScheduler();
    await runBackgroundTokenRefreshTick({ loadConnections, refreshConnection });

    expect(mocks.refreshAntigravityQuota).not.toHaveBeenCalled();
  });

  it("honors the AG_BG_QUOTA_WARMUP opt-out", async () => {
    process.env.AG_BG_QUOTA_WARMUP = "0";
    const refreshConnection = vi.fn(async (c) => c);
    const loadConnections = vi.fn(async () => [conn({ id: "ag-1" })]);

    const { runBackgroundTokenRefreshTick } = await importScheduler();
    await runBackgroundTokenRefreshTick({ loadConnections, refreshConnection });

    expect(mocks.refreshAntigravityQuota).not.toHaveBeenCalled();
  });

  it("keeps the tick alive when warm-up throws (fail-open)", async () => {
    mocks.refreshAntigravityQuota.mockRejectedValue(new Error("quota api down"));
    const refreshConnection = vi.fn(async (c) => c);
    const loadConnections = vi.fn(async () => [conn({ id: "ag-1" }), conn({ id: "ag-2" })]);
    // Instant sleep: fake timers never advance the loop's inter-account delay.
    const sleep = vi.fn(async () => {});

    const { runBackgroundTokenRefreshTick } = await importScheduler();
    await expect(
      runBackgroundTokenRefreshTick({ loadConnections, refreshConnection, sleep })
    ).resolves.toBeUndefined();

    // Both connections still refreshed despite the warm-up failure.
    expect(refreshConnection).toHaveBeenCalledTimes(2);
  });

  it("skips warm-up when no access token is available", async () => {
    const refreshConnection = vi.fn(async () => ({ accessToken: null }));
    const loadConnections = vi.fn(async () => [conn({ id: "ag-1", accessToken: null })]);

    const { runBackgroundTokenRefreshTick } = await importScheduler();
    await runBackgroundTokenRefreshTick({ loadConnections, refreshConnection });

    expect(mocks.refreshAntigravityQuota).not.toHaveBeenCalled();
  });

  it("isBgQuotaWarmupEnabled defaults to ON and parses common toggles", async () => {
    const { isBgQuotaWarmupEnabled } = await importScheduler();
    delete process.env.AG_BG_QUOTA_WARMUP;
    expect(isBgQuotaWarmupEnabled()).toBe(true);
    process.env.AG_BG_QUOTA_WARMUP = "0";
    expect(isBgQuotaWarmupEnabled()).toBe(false);
    process.env.AG_BG_QUOTA_WARMUP = "false";
    expect(isBgQuotaWarmupEnabled()).toBe(false);
    process.env.AG_BG_QUOTA_WARMUP = "off";
    expect(isBgQuotaWarmupEnabled()).toBe(false);
    process.env.AG_BG_QUOTA_WARMUP = "1";
    expect(isBgQuotaWarmupEnabled()).toBe(true);
  });
});
