import { describe, expect, it } from "vitest";
import { getPeriodRange, normalizeUsagePeriod } from "../../src/shared/utils/usagePeriods.js";

describe("usage default period", () => {
  it.each(["today", "24h", "7d", "30d"])("accepts %s", (period) => {
    expect(normalizeUsagePeriod(period)).toBe(period);
  });

  it("falls back to today for custom or unknown defaults", () => {
    expect(normalizeUsagePeriod("custom")).toBe("today");
    expect(normalizeUsagePeriod("21w")).toBe("today");
  });

  it("calculates the one-week preset", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const range = getPeriodRange("7d", now);
    expect(new Date(range.endDate).getTime() - new Date(range.startDate).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
