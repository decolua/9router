import { describe, expect, it } from "vitest";

import {
  QUOTA_SCHEDULER_DEFAULTS,
  getQuotaRefreshDecision,
  getQuotaRefreshSortKey,
  isQuotaRefreshSupported,
  sortQuotaRefreshCandidates,
} from "../../src/lib/quotaRefreshPlanner.js";

describe("quotaRefreshPlanner", () => {
  const now = "2026-04-21T12:00:00.000Z";
  const enabledSettings = { ...QUOTA_SCHEDULER_DEFAULTS, enabled: true };

  it("detects quota refresh support for active OAuth Codex connections", () => {
    expect(isQuotaRefreshSupported({ provider: "codex", authType: "oauth", isActive: true })).toBe(true);
    expect(isQuotaRefreshSupported({ provider: "codex", authType: "apiKey", isActive: true })).toBe(false);
    expect(isQuotaRefreshSupported({ provider: "openai", authType: "oauth", isActive: true })).toBe(false);
    expect(isQuotaRefreshSupported({ provider: "codex", authType: "oauth", isActive: false })).toBe(false);
  });

  it("marks supported connections due when never checked", () => {
    expect(getQuotaRefreshDecision({
      connection: { id: "conn-1", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: enabledSettings,
      hotState: {},
      now,
    })).toMatchObject({
      due: true,
      reason: "never_checked",
    });
  });

  it("skips scheduling when disabled or unsupported", () => {
    expect(getQuotaRefreshDecision({
      connection: { id: "conn-1", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: { ...QUOTA_SCHEDULER_DEFAULTS, enabled: false },
      hotState: {},
      now,
    })).toMatchObject({ due: false, reason: "scheduler_disabled" });

    expect(getQuotaRefreshDecision({
      connection: { id: "conn-2", provider: "openai", authType: "oauth", isActive: true },
      schedulerSettings: enabledSettings,
      hotState: {},
      now,
    })).toMatchObject({ due: false, reason: "unsupported" });
  });

  it("respects future retry windows for exhausted quota", () => {
    expect(getQuotaRefreshDecision({
      connection: { id: "conn-1", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: enabledSettings,
      hotState: {
        quotaState: "exhausted",
        nextRetryAt: "2026-04-21T12:05:00.000Z",
        resetAt: "2026-04-21T12:10:00.000Z",
        lastCheckedAt: "2026-04-21T11:00:00.000Z",
      },
      now,
    })).toMatchObject({
      due: false,
      reason: "waiting_for_retry",
      nextEligibleAt: "2026-04-21T12:10:00.000Z",
    });
  });

  it("treats resetAt as authoritative for quota blockers when retry hints conflict", () => {
    expect(getQuotaRefreshDecision({
      connection: { id: "conn-1", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: enabledSettings,
      hotState: {
        quotaState: "blocked",
        nextRetryAt: "2026-04-21T12:01:00.000Z",
        rateLimitedUntil: "2026-04-21T12:02:00.000Z",
        resetAt: "2026-04-21T12:10:00.000Z",
        lastCheckedAt: "2026-04-21T11:00:00.000Z",
      },
      now,
    })).toMatchObject({
      due: false,
      reason: "waiting_for_retry",
      nextEligibleAt: "2026-04-21T12:10:00.000Z",
    });
  });

  it("rechecks exhausted quota once reset time has passed", () => {
    expect(getQuotaRefreshDecision({
      connection: { id: "conn-1", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: enabledSettings,
      hotState: {
        quotaState: "exhausted",
        resetAt: "2026-04-21T11:55:00.000Z",
        nextRetryAt: "2026-04-21T11:55:00.000Z",
        lastCheckedAt: "2026-04-21T11:50:00.000Z",
      },
      now,
    })).toMatchObject({
      due: true,
      reason: "quota_reset_due",
    });
  });

  it("skips recently checked healthy connections until the success interval elapses", () => {
    expect(getQuotaRefreshDecision({
      connection: { id: "conn-1", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: enabledSettings,
      hotState: {
        quotaState: "ok",
        lastCheckedAt: "2026-04-21T11:56:00.000Z",
      },
      now,
    })).toMatchObject({
      due: false,
      reason: "fresh_success",
      nextEligibleAt: "2026-04-21T12:11:00.000Z",
    });
  });

  it("classifies health-status failures with error freshness reasons", () => {
    expect(getQuotaRefreshDecision({
      connection: { id: "conn-1", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: enabledSettings,
      hotState: {
        healthStatus: "down",
        lastCheckedAt: "2026-04-21T11:56:00.000Z",
      },
      now,
    })).toMatchObject({
      due: false,
      reason: "fresh_error",
      nextEligibleAt: "2026-04-21T12:01:00.000Z",
    });

    expect(getQuotaRefreshDecision({
      connection: { id: "conn-1", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: enabledSettings,
      hotState: {
        healthStatus: "failed",
        lastCheckedAt: "2026-04-21T11:54:00.000Z",
      },
      now,
    })).toMatchObject({
      due: true,
      reason: "stale_error",
    });
  });

  it("uses cadence as a minimum spacing for success and error refreshes", () => {
    const settings = {
      ...enabledSettings,
      cadenceMs: 600000,
      successTtlMs: 60000,
      errorTtlMs: 120000,
    };

    expect(getQuotaRefreshDecision({
      connection: { id: "conn-success", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: settings,
      hotState: {
        quotaState: "ok",
        lastCheckedAt: "2026-04-21T11:56:00.000Z",
      },
      now,
    })).toMatchObject({
      due: false,
      reason: "fresh_success",
      nextEligibleAt: "2026-04-21T12:06:00.000Z",
    });

    expect(getQuotaRefreshDecision({
      connection: { id: "conn-error", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: settings,
      hotState: {
        testStatus: "error",
        lastCheckedAt: "2026-04-21T11:56:00.000Z",
      },
      now,
    })).toMatchObject({
      due: false,
      reason: "fresh_error",
      nextEligibleAt: "2026-04-21T12:06:00.000Z",
    });
  });

  it("handles active or unknown states without quotaState using non-quota TTL logic", () => {
    expect(getQuotaRefreshDecision({
      connection: { id: "conn-active", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: enabledSettings,
      hotState: {
        testStatus: "active",
        lastCheckedAt: "2026-04-21T11:56:00.000Z",
      },
      now,
    })).toMatchObject({
      due: false,
      reason: "fresh_success",
      nextEligibleAt: "2026-04-21T12:11:00.000Z",
    });

    expect(getQuotaRefreshDecision({
      connection: { id: "conn-unknown-fresh", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: enabledSettings,
      hotState: {
        lastCheckedAt: "2026-04-21T11:56:00.000Z",
      },
      now,
    })).toMatchObject({
      due: false,
      reason: "fresh_unknown",
      nextEligibleAt: "2026-04-21T12:01:00.000Z",
    });

    expect(getQuotaRefreshDecision({
      connection: { id: "conn-active-stale", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: enabledSettings,
      hotState: {
        testStatus: "active",
        lastCheckedAt: "2026-04-21T11:40:00.000Z",
      },
      now,
    })).toMatchObject({
      due: true,
      reason: "stale_success",
    });

    expect(getQuotaRefreshDecision({
      connection: { id: "conn-unknown", provider: "codex", authType: "oauth", isActive: true },
      schedulerSettings: enabledSettings,
      hotState: {
        lastCheckedAt: "2026-04-21T11:40:00.000Z",
      },
      now,
    })).toMatchObject({
      due: true,
      reason: "stale_unknown",
    });
  });

  it("sorts due candidates before skipped candidates with deterministic tie-breakers", () => {
    const candidates = [
      {
        connection: { id: "conn-fresh", priority: 9 },
        decision: getQuotaRefreshDecision({
          connection: { id: "conn-fresh", provider: "codex", authType: "oauth", isActive: true, priority: 9 },
          schedulerSettings: enabledSettings,
          hotState: { quotaState: "ok", lastCheckedAt: "2026-04-21T11:58:00.000Z" },
          now,
        }),
      },
      {
        connection: { id: "conn-old", priority: 5 },
        decision: getQuotaRefreshDecision({
          connection: { id: "conn-old", provider: "codex", authType: "oauth", isActive: true, priority: 5 },
          schedulerSettings: enabledSettings,
          hotState: { quotaState: "ok", lastCheckedAt: "2026-04-21T10:00:00.000Z" },
          now,
        }),
      },
      {
        connection: { id: "conn-never", priority: 10 },
        decision: getQuotaRefreshDecision({
          connection: { id: "conn-never", provider: "codex", authType: "oauth", isActive: true, priority: 10 },
          schedulerSettings: enabledSettings,
          hotState: {},
          now,
        }),
      },
      {
        connection: { id: "conn-reset", priority: 1 },
        decision: getQuotaRefreshDecision({
          connection: { id: "conn-reset", provider: "codex", authType: "oauth", isActive: true, priority: 1 },
          schedulerSettings: enabledSettings,
          hotState: {
            quotaState: "exhausted",
            resetAt: "2026-04-21T11:59:00.000Z",
            lastCheckedAt: "2026-04-21T11:00:00.000Z",
          },
          now,
        }),
      },
    ];

    expect(sortQuotaRefreshCandidates(candidates).map((entry) => entry.connection.id)).toEqual([
      "conn-reset",
      "conn-never",
      "conn-old",
      "conn-fresh",
    ]);

    expect(getQuotaRefreshSortKey(candidates[0])).toEqual(expect.any(Array));
  });
});
