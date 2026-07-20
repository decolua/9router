import { describe, expect, it } from "vitest";

const NOW_MS = Date.parse("2026-07-07T10:00:00.000Z");

describe("CodexGo refresh policy", () => {
  it("clamps config defaults and limits", async () => {
    const { normalizeCodexGoRefreshConfig } = await import("../../src/lib/oauth/services/codexGoRefreshPolicy.js");

    expect(normalizeCodexGoRefreshConfig({})).toEqual({
      hourlyLimit: 1,
      autoEnabled: false,
      thresholdRemainingPercent: 5,
    });
    expect(normalizeCodexGoRefreshConfig({
      codexGoRefreshConfig: {
        hourlyLimit: 99,
        autoEnabled: true,
        thresholdRemainingPercent: -10,
      },
    })).toEqual({
      hourlyLimit: 10,
      autoEnabled: true,
      thresholdRemainingPercent: 0,
    });
  });

  it("uses a rolling 1 hour window and reports nextRefreshAt", async () => {
    const { getCodexGoRefreshWindow } = await import("../../src/lib/oauth/services/codexGoRefreshPolicy.js");
    const providerSpecificData = {
      codexGoRefreshConfig: { hourlyLimit: 2 },
      codexGoRefreshState: {
        events: [
          { at: "2026-07-07T08:59:59.000Z", reason: "manual" },
          { at: "2026-07-07T09:05:00.000Z", reason: "manual" },
          { at: "2026-07-07T09:30:00.000Z", reason: "upstream_429" },
        ],
      },
    };

    expect(getCodexGoRefreshWindow(providerSpecificData, NOW_MS)).toMatchObject({
      used: 2,
      limit: 2,
      remaining: 0,
      exhausted: true,
      nextRefreshAt: "2026-07-07T10:05:00.000Z",
    });
  });

  it("reports nextRefreshAt after enough events expire when used exceeds limit", async () => {
    const { getCodexGoRefreshWindow } = await import("../../src/lib/oauth/services/codexGoRefreshPolicy.js");
    const providerSpecificData = {
      codexGoRefreshConfig: { hourlyLimit: 1 },
      codexGoRefreshState: {
        events: [
          { at: "2026-07-07T09:05:00.000Z", reason: "manual" },
          { at: "2026-07-07T09:30:00.000Z", reason: "upstream_429" },
        ],
      },
    };

    expect(getCodexGoRefreshWindow(providerSpecificData, NOW_MS)).toMatchObject({
      used: 2,
      limit: 1,
      exhausted: true,
      nextRefreshAt: "2026-07-07T10:30:00.000Z",
    });
  });

  it("records successful refresh events and keeps last refresh source", async () => {
    const { recordCodexGoRefresh } = await import("../../src/lib/oauth/services/codexGoRefreshPolicy.js");
    const updated = recordCodexGoRefresh({
      authMethod: "codexgo",
      codexGoRefreshState: { events: [] },
    }, "upstream_429", "2026-07-07T10:01:00.000Z", {
      session: { remaining: 4 },
      weekly: { remaining: 80 },
      checkedAt: "2026-07-07T10:00:00.000Z",
    });

    expect(updated.codexGoRefreshState).toMatchObject({
      lastRefreshAt: "2026-07-07T10:01:00.000Z",
      lastRefreshReason: "upstream_429",
      lastQuotaSnapshot: {
        session: { remaining: 4 },
        weekly: { remaining: 80 },
        checkedAt: "2026-07-07T10:00:00.000Z",
      },
      lastError: null,
    });
    expect(updated.codexGoRefreshState.events).toEqual([
      { at: "2026-07-07T10:01:00.000Z", reason: "upstream_429" },
    ]);
  });

  it("detects quota snapshots at or below threshold", async () => {
    const {
      getCodexGoQuotaSnapshot,
      shouldAutoRefreshCodexGoFromSnapshot,
    } = await import("../../src/lib/oauth/services/codexGoRefreshPolicy.js");
    const snapshot = getCodexGoQuotaSnapshot({
      quotas: {
        session: { remaining: 6, resetAt: "2026-07-07T11:00:00.000Z" },
        weekly: { remaining: 4, resetAt: "2026-07-14T00:00:00.000Z" },
      },
    }, "2026-07-07T10:00:00.000Z");

    expect(snapshot).toMatchObject({
      session: { remaining: 6 },
      weekly: { remaining: 4 },
      checkedAt: "2026-07-07T10:00:00.000Z",
    });
    expect(shouldAutoRefreshCodexGoFromSnapshot(snapshot, 5)).toBe(true);
    expect(shouldAutoRefreshCodexGoFromSnapshot(snapshot, 3)).toBe(false);
  });
});
