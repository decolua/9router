import { describe, it, expect } from "vitest";
import {
  poolWindow,
  buildRateLimitHeaders,
  normalizePlan,
  capacityFor,
} from "@/sse/services/codexUsagePool.js";

const account = (plan, sessionUsed, weeklyUsed, resetAt) => ({
  plan,
  quotas: {
    ...(sessionUsed === null ? {} : { session: { used: sessionUsed, total: 100, remaining: 100 - sessionUsed, resetAt } }),
    ...(weeklyUsed === null ? {} : { weekly: { used: weeklyUsed, total: 100, remaining: 100 - weeklyUsed, resetAt } }),
  },
});

describe("poolWindow", () => {
  it("pools equal plans as the share of the whole pool", () => {
    // 60% + 20% over two Plus accounts = 80 of 200 points = 40%
    const pooled = poolWindow([account("plus", 60, null), account("plus", 20, null)], "primary");
    expect(pooled.usedPercent).toBe(40);
  });

  it("never exceeds 100% no matter how many accounts are spent", () => {
    const pooled = poolWindow(
      [account("plus", 100, null), account("plus", 100, null), account("plus", 100, null)],
      "primary"
    );
    expect(pooled.usedPercent).toBe(100);
  });

  it("weights a Pro account above a Plus one", () => {
    // Pro (1500) fully spent + Plus (225) untouched → 1500/1725 ≈ 87%,
    // far from the 50% an unweighted mean would report.
    const pooled = poolWindow([account("pro", 100, null), account("plus", 0, null)], "primary");
    expect(pooled.usedPercent).toBeCloseTo(86.96, 1);
  });

  it("reports the earliest reset, when capacity next comes back", () => {
    const pooled = poolWindow(
      [
        account("plus", 60, null, "2026-08-12T18:00:00.000Z"),
        account("plus", 20, null, "2026-08-12T15:00:00.000Z"),
      ],
      "primary"
    );
    expect(new Date(pooled.resetAt).toISOString()).toBe("2026-08-12T15:00:00.000Z");
  });

  it("pools free accounts against each other", () => {
    const pooled = poolWindow([account("free", 30, null), account("free", 10, null)], "primary");
    expect(pooled.usedPercent).toBe(20);
  });

  it("keeps a free account in the pool once a paid account joins", () => {
    // Free carries real weight on the 5h window, so a spent free account still
    // moves the number instead of being silently dropped.
    expect(capacityFor("free", "primary")).toBeGreaterThan(0);
    const pooled = poolWindow([account("free", 100, null), account("plus", 0, null)], "primary");
    expect(pooled.usedPercent).toBeCloseTo(13.04, 1);
  });

  it("ignores accounts that do not report the window", () => {
    const pooled = poolWindow([account("plus", 60, null), account("plus", null, 40)], "primary");
    expect(pooled.usedPercent).toBe(60);
  });

  it("returns null when nothing reports the window", () => {
    expect(poolWindow([account("plus", null, 40)], "primary")).toBeNull();
    expect(poolWindow([], "secondary")).toBeNull();
  });
});

describe("normalizePlan", () => {
  it("keeps prolite distinct from pro", () => {
    expect(normalizePlan("pro_lite")).toBe("prolite");
    expect(normalizePlan("pro")).toBe("pro");
  });

  it("weights an unreadable plan as plus rather than dropping it", () => {
    expect(normalizePlan("unknown")).toBe("plus");
    expect(normalizePlan(null)).toBe("plus");
    expect(capacityFor("something-new", "primary")).toBe(225);
  });

  it("reads the plan names ChatGPT actually returns", () => {
    expect(normalizePlan("chatgpt_plus")).toBe("plus");
    expect(normalizePlan("ChatGPT Pro")).toBe("pro");
    expect(normalizePlan("enterprise")).toBe("enterprise");
  });
});

describe("buildRateLimitHeaders", () => {
  it("emits the headers Codex reads its usage bar from", () => {
    const headers = buildRateLimitHeaders([
      account("plus", 60, 10, "2026-08-12T18:00:00.000Z"),
      account("plus", 20, 30, "2026-08-12T15:00:00.000Z"),
    ]);
    expect(headers).toEqual({
      "x-codex-primary-used-percent": "40",
      "x-codex-primary-window-minutes": "300",
      "x-codex-primary-reset-at": "1786546800",
      "x-codex-secondary-used-percent": "20",
      "x-codex-secondary-window-minutes": "10080",
      "x-codex-secondary-reset-at": "1786546800",
    });
  });

  it("omits a window no account reports instead of sending a zero bar", () => {
    const headers = buildRateLimitHeaders([account("free", 1, null, "2026-09-10T15:20:44.000Z")]);
    expect(headers["x-codex-primary-used-percent"]).toBe("1");
    expect(headers).not.toHaveProperty("x-codex-secondary-used-percent");
  });

  it("returns nothing when no usage could be fetched", () => {
    expect(buildRateLimitHeaders([])).toEqual({});
  });
});
