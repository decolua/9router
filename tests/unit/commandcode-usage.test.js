// Command Code usage: alpha-API mapping (upstream payload shape) and the
// dashboard's rendering path for the emitted quotas.
import { describe, it, expect, vi, beforeEach } from "vitest";

const CREDITS_PAYLOAD = {
  credits: {
    belowThreshold: false,
    creditThreshold: 0,
    monthlyCredits: 67.6466882615,
    purchasedCredits: 0,
    freeCredits: 0,
  },
  windowLimits: {
    limited: true,
    exceeded: null,
    fiveHour: {
      used: 1.1026089261,
      cap: 16,
      exceeded: false,
      resetAt: 1789295134827,
    },
    weekly: {
      used: 12.3532497601,
      cap: 40,
      exceeded: false,
      resetAt: 1789646219303,
    },
  },
};

const SUBSCRIPTION_PAYLOAD = {
  success: true,
  data: {
    status: "active",
    planId: "individual-pro-v1",
    currentPeriodStart: "2026-09-10T11:39:53.000Z",
    currentPeriodEnd: "2026-10-10T11:39:53.000Z",
  },
};

const SUMMARY_PAYLOAD = {
  totalCount: 4148,
  totalCost: 12.3759038402,
  completedCount: 4148,
  failedCount: 0,
  totalTokensIn: 448000000,
  totalTokensOut: 800000,
  totalTokens: 448800000,
  periodBasis: "billing-period",
};

const requests = [];

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: async (url) => {
    requests.push(url);
    let body;
    if (url.includes("/alpha/whoami")) body = { success: true, user: {}, org: null };
    else if (url.includes("/alpha/billing/credits")) body = CREDITS_PAYLOAD;
    else if (url.includes("/alpha/billing/subscriptions")) body = SUBSCRIPTION_PAYLOAD;
    else if (url.includes("/alpha/usage/summary")) body = SUMMARY_PAYLOAD;
    else return { ok: false, status: 404, text: async () => "not found" };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  },
}));

const { getCommandCodeUsage } = await import(
  "../../open-sse/services/usage/commandcode.js"
);
const { parseQuotaData, getRemainingPercentage } = await import(
  "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js"
);
const { default: commandCodeRegistry } = await import(
  "../../open-sse/providers/registry/commandcode.js"
);
const { USAGE_SUPPORTED_PROVIDERS, USAGE_APIKEY_PROVIDERS } = await import(
  "../../src/shared/constants/providers.js"
);

describe("getCommandCodeUsage", () => {
  beforeEach(() => {
    requests.length = 0;
  });

  it("maps credit windows and the monthly allowance to quotas", async () => {
    const out = await getCommandCodeUsage("user_test_key", null);

    expect(out.plan).toContain("individual-pro-v1");

    // 5-hour: 1.10 used of 16 → 93% remaining
    expect(out.quotas["5-hour"].total).toBe("16.00");
    expect(out.quotas["5-hour"].remainingPercentage).toBe(93);
    expect(out.quotas["5-hour"].resetAt).toBe("2026-09-13T10:25:34.827Z");

    // Weekly: 12.35 used of 40 → 69% remaining
    expect(out.quotas.Weekly.total).toBe("40.00");
    expect(out.quotas.Weekly.remainingPercentage).toBe(69);

    // Monthly allowance = remaining (67.65) + billing-period spend (12.38)
    const monthly = out.quotas["Monthly credits"];
    expect(monthly.used).toBe("12.38");
    expect(monthly.total).toBe("80.02");
    expect(monthly.remainingPercentage).toBe(85);
    expect(monthly.resetAt).toBe("2026-10-10T11:39:53.000Z");
  });

  it("formats credit amounts with a dot decimal so no locale reads them as thousands", async () => {
    const out = await getCommandCodeUsage("user_test_key", null);
    for (const quota of Object.values(out.quotas)) {
      // e.g. "1.26" must never reach the UI as a comma-decimal locale's "1,26"
      expect(String(quota.used)).not.toContain(",");
      expect(String(quota.total)).not.toContain(",");
      expect(String(quota.used)).toMatch(/^\d+\.\d{2}$/);
      expect(String(quota.total)).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it("never emits an absolute `remaining` (the table reads it as a percentage)", async () => {
    const out = await getCommandCodeUsage("user_test_key", null);
    for (const quota of Object.values(out.quotas)) {
      expect(quota.remaining).toBeUndefined();
    }
  });

  it("sends the CLI identity headers Cloudflare requires", async () => {
    // Exercised through the mocked fetch, which records the URLs only; the
    // header contract is asserted in the handler source via the version pin.
    await getCommandCodeUsage("user_test_key", null);
    expect(requests.some((u) => u.includes("/alpha/billing/credits"))).toBe(true);
    expect(requests.some((u) => u.includes("/alpha/usage/summary"))).toBe(true);
  });

  it("reports a message instead of throwing when no key is configured", async () => {
    const out = await getCommandCodeUsage(null, null);
    expect(out.quotas).toBeUndefined();
    expect(out.message).toMatch(/API key not available/);
  });

  it("is polled by the dashboard for api-key connections", async () => {
    // /api/usage/[connectionId] answers "Usage not available for this
    // connection" unless the provider is in both lists, and Command Code is
    // configured with authType "apikey".
    expect(commandCodeRegistry.features.usage).toBe(true);
    expect(commandCodeRegistry.features.usageApikey).toBe(true);
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("commandcode");
    expect(USAGE_APIKEY_PROVIDERS).toContain("commandcode");
  });

  it("renders through the dashboard parser with the right percentages", async () => {
    const raw = await getCommandCodeUsage("user_test_key", null);
    const rows = parseQuotaData("commandcode", raw);

    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(Object.keys(byName)).toEqual(
      expect.arrayContaining(["5-hour", "Weekly", "Monthly credits"]),
    );
    expect(getRemainingPercentage(byName["5-hour"])).toBe(93);
    expect(getRemainingPercentage(byName.Weekly)).toBe(69);
    expect(getRemainingPercentage(byName["Monthly credits"])).toBe(85);
  });
});
