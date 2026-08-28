import { describe, expect, it } from "vitest";
import { parseOpenRouterKeyData } from "open-sse/services/usage/misc.js";

describe("parseOpenRouterKeyData", () => {
  it("capped key → Credit (USD) quota with monthly reset", () => {
    const out = parseOpenRouterKeyData({
      limit: 20, limit_remaining: 12.5, limit_reset: "monthly",
      usage: 7.5, usage_monthly: 7.5, is_free_tier: false,
    });
    expect(out.plan).toBe("Pay-as-you-go");
    const q = out.quotas["Credit (USD)"];
    expect(q.total).toBe(20);
    expect(q.remaining).toBe(12.5);
    expect(q.used).toBe(7.5);
    expect(q.remainingPercentage).toBeCloseTo(62.5);
    expect(q.unlimited).toBe(false);
    expect(new Date(q.resetAt).getUTCDate()).toBe(1); // início do próximo mês UTC
  });

  it("uncapped key (limit null) → unlimited monthly-usage counter", () => {
    const out = parseOpenRouterKeyData({
      limit: null, limit_remaining: null, limit_reset: "monthly",
      usage: 42, usage_monthly: 3.25, is_free_tier: false,
    });
    expect(out.quotas["Credit (USD)"]).toBeUndefined();
    const q = out.quotas["Used this month (USD)"];
    expect(q.used).toBe(3.25);
    expect(q.unlimited).toBe(true);
  });

  it("free tier label + daily reset", () => {
    const out = parseOpenRouterKeyData({ limit: 5, limit_remaining: 5, limit_reset: "daily", is_free_tier: true });
    expect(out.plan).toBe("Free tier");
    const reset = new Date(out.quotas["Credit (USD)"].resetAt);
    expect(reset.getTime()).toBeGreaterThan(Date.now());
    expect(reset.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3600 * 1000);
  });

  it("missing limit_remaining falls back to full limit; unknown interval → no resetAt", () => {
    const out = parseOpenRouterKeyData({ limit: 10, limit_reset: "weekly" });
    const q = out.quotas["Credit (USD)"];
    expect(q.remaining).toBe(10);
    expect(q.resetAt).toBeNull();
  });
});
