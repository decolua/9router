import { describe, it, expect } from "vitest";
import {
  REFRESH_INTERVAL_MS,
  CLAUDE_REFRESH_INTERVAL_MS,
  shouldRefreshQuota,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

// The dashboard auto-refreshes quotas every REFRESH_INTERVAL_MS (relaxed from 60s to
// 5 min to cut backend load as more providers gain quota tracking). These tests drive
// the per-tick decision ProviderLimits uses, over simulated ticks, rather than
// re-deriving the constants.
const pollMinutes = (provider, ticks, opts) =>
  Array.from({ length: ticks }, (_, i) => i + 1)
    .filter((tick) => shouldRefreshQuota(provider, tick, opts))
    .map((tick) => (tick * (opts?.baseMs ?? REFRESH_INTERVAL_MS)) / 60000);

describe("Provider Limits refresh cadence", () => {
  it("auto-refreshes every 5 minutes, not every 60 seconds", () => {
    expect(REFRESH_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it("polls ordinary providers on every tick over an hour", () => {
    expect(pollMinutes("codex", 12)).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
  });

  it("keeps Claude's rate-limited quota endpoint at a 10-minute cadence", () => {
    expect(CLAUDE_REFRESH_INTERVAL_MS).toBe(10 * 60 * 1000);
    expect(pollMinutes("claude", 12)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it("polls Claude immediately on a manual refresh", () => {
    expect(shouldRefreshQuota("claude", 1)).toBe(false);
    expect(shouldRefreshQuota("claude", 1, { force: true })).toBe(true);
  });

  it("never stops polling Claude when the base interval exceeds Claude's", () => {
    // 15-minute ticks with a 10-minute Claude target: the ratio rounds to 1, and a
    // ratio that rounded to 0 must still poll rather than produce tick % 0 (NaN).
    expect(pollMinutes("claude", 4, { baseMs: 15 * 60000 })).toEqual([15, 30, 45, 60]);
    expect(pollMinutes("claude", 3, { baseMs: 30 * 60000, claudeMs: 10 * 60000 })).toEqual([30, 60, 90]);
  });
});
