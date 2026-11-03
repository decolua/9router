import { describe, it, expect, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getOpenRouterUsage } from "../../open-sse/services/usage/openrouter.js";
import { summarizeLocalUsage } from "../../open-sse/services/usage/muse.js";
import { USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import { sortConnections } from "../../src/app/api/providers/client/sortConnections.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const json = (data, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { "Content-Type": "application/json" } });

describe("openrouter + muse usage", () => {
  it("registers both providers for the quota page", () => {
    for (const p of ["openrouter", "muse"]) {
      expect(USAGE_SUPPORTED_PROVIDERS).toContain(p);
      expect(USAGE_APIKEY_PROVIDERS).toContain(p);
    }
  });

  it("maps OpenRouter credits, budgets and spend", async () => {
    proxyAwareFetch.mockImplementation(async (url) => url.endsWith("/credits")
      ? json({ total_credits: 195, total_usage: 190.2 })
      : json({ limit: null, usage_daily: 0.0056, usage_weekly: 0.0068, usage_monthly: 0.0169,
          budgets: [
            { limit_usd: 20, remaining_usd: 20, reset_interval: "daily", resets_at: "2026-11-04T00:00:00.000Z" },
            { limit_usd: 20, remaining_usd: 19.99, reset_interval: "daily", resets_at: "2026-11-04T00:00:00.000Z" },
          ] }));
    const res = await getOpenRouterUsage("sk-or-x");
    expect(res.quotas["Balance (USD)"]).toMatchObject({ total: 4.8, isCreditBalance: true });
    expect(res.quotas["Daily budget (USD)"]).toMatchObject({ used: 0.01, total: 20 });
    expect(res.quotas["Spent today (USD)"]).toMatchObject({ used: 0.01, unlimited: true });
    expect(res.quotas["Key limit (USD)"]).toBeUndefined();
    const rows = parseQuotaData("openrouter", res);
    expect(rows.find((r) => r.name === "Balance (USD)").isCreditBalance).toBe(true);
    expect(rows.find((r) => r.name === "Spent today (USD)").unlimited).toBe(true);
  });

  it("reports OpenRouter auth failure", async () => {
    proxyAwareFetch.mockResolvedValue(new Response("", { status: 401 }));
    expect((await getOpenRouterUsage("bad")).message).toMatch(/authentication failed/);
    expect((await getOpenRouterUsage("")).message).toMatch(/not available/);
  });

  it("summarises Muse local log by window", () => {
    const now = Date.parse("2026-11-03T12:00:00Z");
    const q = summarizeLocalUsage([
      { timestamp: "2026-11-03T11:00:00Z", status: "ok", tokens: { total_tokens: 100 } },
      { timestamp: "2026-11-03T01:00:00Z", status: "error", tokens: { total_tokens: 50 } },
      { timestamp: "2026-10-30T12:00:00Z", status: "ok", tokens: { total_tokens: 10 } },
    ], now);
    expect(q["Last 5h requests"].used).toBe(1);
    expect(q["Last 24h tokens"].used).toBe(150);
    expect(q["Last 24h errors"].used).toBe(1);
    expect(q["Last 7d requests"].used).toBe(3);
    expect(q["Last 5h errors"]).toBeUndefined();
  });

  it("sorts quota cards by 7d request count, priority breaks ties", () => {
    const conns = [
      { id: "a", provider: "antigravity", priority: 1 },
      { id: "c", provider: "claude", priority: 1 },
      { id: "o", provider: "openrouter", priority: 2 },
      { id: "m", provider: "muse", priority: 1 },
    ];
    const order = sortConnections(conns, "usage", { c: 15000, o: 800, a: 2000 }).map((x) => x.id);
    expect(order).toEqual(["c", "a", "o", "m"]);
  });
});
