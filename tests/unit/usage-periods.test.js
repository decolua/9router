import { describe, it, expect } from "vitest";
import {
  USAGE_PERIOD_OPTIONS,
  VALID_USAGE_STATS_PERIODS,
  VALID_USAGE_CHART_PERIODS,
  getUsagePeriodDays,
  getChartDayBucketCount,
} from "@/lib/usagePeriods.js";

describe("usagePeriods", () => {
  it("exposes extended analytics periods including all-time", () => {
    const values = USAGE_PERIOD_OPTIONS.map((o) => o.value);
    expect(values).toContain("90d");
    expect(values).toContain("180d");
    expect(values).toContain("365d");
    expect(values).toContain("all");
    expect(values.indexOf("60d")).toBeLessThan(values.indexOf("90d"));
  });

  it("stats and chart validators accept the same extended set", () => {
    for (const period of ["90d", "180d", "365d", "all"]) {
      expect(VALID_USAGE_STATS_PERIODS.has(period)).toBe(true);
      expect(VALID_USAGE_CHART_PERIODS.has(period)).toBe(true);
    }
    expect(VALID_USAGE_STATS_PERIODS.has("not-a-period")).toBe(false);
  });

  it("maps day periods to calendar lookback counts", () => {
    expect(getUsagePeriodDays("90d")).toBe(90);
    expect(getUsagePeriodDays("180d")).toBe(180);
    expect(getUsagePeriodDays("365d")).toBe(365);
    expect(getUsagePeriodDays("all")).toBeNull();
    expect(getUsagePeriodDays("today")).toBeNull();
  });

  it("chart bucket count matches day periods; all is dynamic", () => {
    expect(getChartDayBucketCount("90d")).toBe(90);
    expect(getChartDayBucketCount("365d")).toBe(365);
    expect(getChartDayBucketCount("all")).toBeNull();
  });
});