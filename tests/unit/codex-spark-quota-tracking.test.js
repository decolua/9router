import { describe, it, expect } from "vitest";
import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";
import { normalizeCodexUsage } from "../../open-sse/services/usage/codex.js";

describe("Codex Spark Quota Tracking (#3431)", () => {
  it("labels a Pro account's single seven-day primary window as weekly", () => {
    const usage = normalizeCodexUsage({
      plan_type: "pro",
      rate_limit: {
        primary_window: {
          used_percent: 1,
          limit_window_seconds: 604800,
          reset_at: 1788654857,
        },
        secondary_window: null,
      },
    });

    expect(usage.plan).toBe("pro");
    expect(usage.quotas.session).toBeUndefined();
    expect(usage.quotas.weekly).toMatchObject({ used: 1, remaining: 99 });
    expect(parseQuotaData("codex", usage)[0].name).toBe("Weekly");
  });

  it("correctly normalizes spark_session and spark_weekly quotas with display labels", () => {
    const mockCodexUsage = {
      plan: "team",
      quotas: {
        session: { used: 20, total: 100, remaining: 80, resetAt: "2026-08-22T05:00:00.000Z" },
        weekly: { used: 40, total: 100, remaining: 60, resetAt: "2026-08-28T05:00:00.000Z" },
        review_session: { used: 0, total: 100, remaining: 100, resetAt: "2026-08-22T05:00:00.000Z" },
        spark_session: { used: 12, total: 100, remaining: 88, resetAt: "2026-08-22T05:00:00.000Z" },
        spark_weekly: { used: 25, total: 100, remaining: 75, resetAt: "2026-08-28T05:00:00.000Z" },
      },
    };

    const parsed = parseQuotaData("codex", mockCodexUsage);

    const sparkSession = parsed.find((q) => q.name === "Spark (5h)");
    const sparkWeekly = parsed.find((q) => q.name === "Spark (Weekly)");
    const session = parsed.find((q) => q.name === "5h");
    const weekly = parsed.find((q) => q.name === "Weekly");

    expect(sparkSession).toBeDefined();
    expect(sparkSession.used).toBe(12);
    expect(sparkSession.remaining).toBe(88);

    expect(sparkWeekly).toBeDefined();
    expect(sparkWeekly.used).toBe(25);
    expect(sparkWeekly.remaining).toBe(75);

    expect(session).toBeDefined();
    expect(session.used).toBe(20);
    expect(weekly).toBeDefined();
    expect(weekly.used).toBe(40);
  });
});
