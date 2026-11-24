import { describe, expect, it } from "vitest";
import { accountQuotaWindows, normalizeQuotaReserve, quotaWindowOf, remainingPercent } from "@/shared/constants/quotaWindows.js";

describe("quota windows", () => {
  it.each([
    ["session", "5h"], ["session (5h)", "5h"], ["Session (5h)", "5h"], ["Rolling", "5h"],
    ["weekly", "7d"], ["weekly (7d)", "7d"], ["Weekly (7d)", "7d"], ["Weekly SuperGrok", "7d"],
    ["Monthly", "30d"], ["Monthly included", "30d"],
  ])("maps the account-wide key %s to %s", (key, windowId) => {
    expect(quotaWindowOf(key)).toBe(windowId);
  });

  it.each(["review_weekly", "spark_session", "weekly sonnet (7d)", "MiniMax-M2 (5h)", "Credits", "Ratelimit"])(
    "leaves the per-model or credit pool %s out", (key) => {
      expect(quotaWindowOf(key)).toBeNull();
    });

  it("reads remaining share from each handler's shape", () => {
    expect(remainingPercent({ used: 30, total: 100, remaining: 70 })).toBe(70);
    expect(remainingPercent({ remainingPercentage: 12 })).toBe(12);
    expect(remainingPercent({ used: 450, total: 600 })).toBe(25);
    expect(remainingPercent({ unlimited: true })).toBe(100);
    expect(remainingPercent({ used: 1 })).toBeNull();
  });

  it("keeps the tightest key per window", () => {
    const windows = accountQuotaWindows({
      session: { used: 40, total: 100, remaining: 60, resetAt: "a" },
      weekly: { used: 85, total: 100, remaining: 15, resetAt: "b" },
      review_weekly: { used: 100, total: 100, remaining: 0, resetAt: "c" },
    });
    expect(windows).toEqual({ "5h": { remaining: 60, resetAt: "a" }, "7d": { remaining: 15, resetAt: "b" } });
  });

  it("normalizes the reserve to whole percentages between 1 and 99", () => {
    expect(normalizeQuotaReserve({ "5h": "20", "7d": 0, "30d": 100, bogus: 5 })).toEqual({ "5h": 20 });
    expect(normalizeQuotaReserve(null)).toEqual({});
  });
});
