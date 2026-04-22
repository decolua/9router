import { describe, expect, it } from "vitest";

import {
  QUOTA_REFRESH_RUN_STATES,
  createQuotaRefreshState,
} from "../../src/lib/quotaRefreshState.js";

describe("quotaRefreshState", () => {
  it("starts idle with stable scheduler metadata", () => {
    const state = createQuotaRefreshState();

    expect(state.getSnapshot()).toEqual({
      status: QUOTA_REFRESH_RUN_STATES.IDLE,
      currentRun: null,
      lastRun: null,
      nextScheduledAt: null,
      cancelRequested: false,
      restartRequested: false,
      progress: {
        totalCount: 0,
        completedCount: 0,
        successCount: 0,
        errorCount: 0,
        skippedCount: 0,
      },
      error: null,
    });
  });

  it("tracks scheduling, run progress, and cancellation", () => {
    const timestamps = [
      "2026-04-21T12:00:00.000Z",
      "2026-04-21T12:05:00.000Z",
      "2026-04-21T12:05:30.000Z",
    ];
    const state = createQuotaRefreshState({ now: () => timestamps.shift() || "2026-04-21T12:06:00.000Z" });

    state.setNextScheduledAt("2026-04-21T12:05:00.000Z");
    state.startRun({
      trigger: "timer",
      metadata: { source: "startup" },
      progress: { totalCount: 3 },
    });
    state.updateProgress({ completedCount: 1, successCount: 1, totalCount: 3 });
    state.requestCancel("shutdown");

    expect(state.getSnapshot()).toMatchObject({
      status: QUOTA_REFRESH_RUN_STATES.CANCELLING,
      nextScheduledAt: "2026-04-21T12:05:00.000Z",
      cancelRequested: true,
      progress: {
        totalCount: 3,
        completedCount: 1,
        successCount: 1,
        errorCount: 0,
        skippedCount: 0,
      },
      currentRun: {
        trigger: "timer",
        metadata: { source: "startup" },
        cancelReason: "shutdown",
      },
    });

    state.finishRun({ outcome: "scaffold_only" });

    expect(state.getSnapshot()).toMatchObject({
      status: QUOTA_REFRESH_RUN_STATES.IDLE,
      currentRun: null,
      cancelRequested: false,
      error: null,
      progress: {
        totalCount: 0,
        completedCount: 0,
        successCount: 0,
        errorCount: 0,
        skippedCount: 0,
      },
      lastRun: {
        trigger: "timer",
        result: { outcome: "scaffold_only" },
        progress: {
          totalCount: 3,
          completedCount: 1,
          successCount: 1,
          errorCount: 0,
          skippedCount: 0,
        },
      },
    });
  });

  it("stores normalized scheduler errors and clears back to idle", () => {
    const state = createQuotaRefreshState({ now: () => "2026-04-21T12:10:00.000Z" });

    state.startRun({ trigger: "manual" });
    state.requestRestart("settings_changed");
    state.failRun(new Error("quota refresh failed"));

    expect(state.getSnapshot()).toMatchObject({
      status: QUOTA_REFRESH_RUN_STATES.ERROR,
      restartRequested: true,
      currentRun: null,
      error: {
        name: "Error",
        message: "quota refresh failed",
      },
      lastRun: {
        trigger: "manual",
        error: {
          message: "quota refresh failed",
        },
      },
    });

    state.clearError();

    expect(state.getSnapshot()).toMatchObject({
      status: QUOTA_REFRESH_RUN_STATES.IDLE,
      error: null,
      restartRequested: true,
    });
  });
});
