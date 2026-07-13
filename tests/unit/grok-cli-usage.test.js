import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { parseGrokCliBilling } from "../../open-sse/services/usage/grok-cli.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Free/promo exhausted: no percent fields, onDemandCap=0 (legacy path). */
const EXHAUSTED_BILLING = {
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-07-08T00:00:00+00:00",
      end: "2026-07-15T00:00:00+00:00",
    },
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 0 },
    topUpMethod: "TOP_UP_METHOD_SAVED_PAYMENT_METHOD",
    billingPeriodStart: "2026-07-08T00:00:00+00:00",
    billingPeriodEnd: "2026-07-15T00:00:00+00:00",
  },
};

/** Absolute on-demand + prepaid (older / top-up style accounts). */
const ACTIVE_BILLING = {
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-07-08T00:00:00+00:00",
      end: "2026-07-15T00:00:00+00:00",
    },
    onDemandCap: { val: 100 },
    onDemandUsed: { val: 35 },
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 12.5 },
    billingPeriodStart: "2026-07-08T00:00:00+00:00",
    billingPeriodEnd: "2026-07-15T00:00:00+00:00",
  },
};

/**
 * Live SuperGrok / X Premium+ shape captured from cli-chat-proxy:
 * onDemandCap stays 0 while creditUsagePercent + productUsage carry the real state.
 */
const UNIFIED_ACTIVE_BILLING = {
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-07-10T18:08:56.887518+00:00",
      end: "2026-07-17T18:08:56.887518+00:00",
    },
    creditUsagePercent: 55.0,
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    productUsage: [
      { product: "GrokBuild", usagePercent: 45.0 },
      { product: "GrokChat", usagePercent: 10.0 },
    ],
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 0 },
    topUpMethod: "TOP_UP_METHOD_SAVED_PAYMENT_METHOD",
    billingPeriodStart: "2026-07-10T18:08:56.887518+00:00",
    billingPeriodEnd: "2026-07-17T18:08:56.887518+00:00",
  },
};

const UNIFIED_EXHAUSTED_BILLING = {
  config: {
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      start: "2026-07-06T13:52:09.270845+00:00",
      end: "2026-07-13T13:52:09.270845+00:00",
    },
    creditUsagePercent: 100.0,
    onDemandCap: { val: 0 },
    onDemandUsed: { val: 0 },
    productUsage: [{ product: "GrokBuild", usagePercent: 100.0 }],
    isUnifiedBillingUser: true,
    prepaidBalance: { val: 0 },
    billingPeriodStart: "2026-07-06T13:52:09.270845+00:00",
    billingPeriodEnd: "2026-07-13T13:52:09.270845+00:00",
  },
};

const PLAIN_MONTHLY_BILLING = {
  config: {
    monthlyLimit: { val: 20000 },
    used: { val: 6689 },
    onDemandCap: { val: 0 },
    billingPeriodStart: "2026-07-01T00:00:00+00:00",
    billingPeriodEnd: "2026-08-01T00:00:00+00:00",
  },
};

const USER_PROFILE = {
  userId: "d84768dd-224d-4052-ba49-0d336fa9160c",
  email: "user@example.com",
  hasGrokCodeAccess: true,
  subscriptionTier: null,
};

const SUPERGROK_USER = {
  ...USER_PROFILE,
  subscriptionTier: "XPremiumPlus",
};

describe("grok-cli registry usage flag", () => {
  it("exposes transport.usage urls", () => {
    const cfg = PROVIDERS["grok-cli"];
    expect(cfg.usage?.url).toContain("/v1/billing");
    expect(cfg.usage?.userUrl).toContain("/v1/user");
  });

  it("is listed in USAGE_SUPPORTED_PROVIDERS", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("grok-cli");
  });
});

describe("parseGrokCliBilling", () => {
  it("maps on-demand cap/used + prepaid balance", () => {
    const parsed = parseGrokCliBilling(ACTIVE_BILLING, USER_PROFILE);
    expect(parsed.plan).toBe("Grok Code");
    expect(parsed.quotas["On-demand"]).toMatchObject({
      used: 35,
      total: 100,
      remainingPercentage: 65,
    });
    // Prepaid is remaining-balance style: 0 used of current pot
    expect(parsed.quotas.Prepaid).toMatchObject({
      used: 0,
      total: 12.5,
      remainingPercentage: 100,
    });
    expect(parsed.exhausted).toBe(false);
  });

  it("maps SuperGrok productUsage percents (does not treat onDemandCap=0 as exhausted)", () => {
    const parsed = parseGrokCliBilling(UNIFIED_ACTIVE_BILLING, SUPERGROK_USER);
    expect(parsed.plan).toBe("X Premium Plus");
    // Per-product bars — NOT the synthetic 1/1 On-demand depleted row
    expect(parsed.quotas["On-demand"]).toBeUndefined();
    expect(parsed.quotas["Grok Build"]).toMatchObject({
      used: 45,
      total: 100,
      remainingPercentage: 55,
    });
    expect(parsed.quotas["Grok Chat"]).toMatchObject({
      used: 10,
      total: 100,
      remainingPercentage: 90,
    });
    expect(parsed.exhausted).toBe(false);
  });

  it("maps fully used SuperGrok productUsage as exhausted", () => {
    const parsed = parseGrokCliBilling(UNIFIED_EXHAUSTED_BILLING, SUPERGROK_USER);
    expect(parsed.quotas["Grok Build"]).toMatchObject({
      used: 100,
      total: 100,
      remainingPercentage: 0,
    });
    expect(parsed.exhausted).toBe(true);
  });

  it("falls back to creditUsagePercent when productUsage is missing", () => {
    const billing = {
      config: {
        creditUsagePercent: 30,
        onDemandCap: { val: 0 },
        onDemandUsed: { val: 0 },
        isUnifiedBillingUser: true,
        billingPeriodEnd: "2026-07-17T00:00:00+00:00",
      },
    };
    const parsed = parseGrokCliBilling(billing, SUPERGROK_USER);
    expect(parsed.quotas.Credits).toMatchObject({
      used: 30,
      total: 100,
      remainingPercentage: 70,
    });
    expect(parsed.quotas["On-demand"]).toBeUndefined();
  });

  it("merges plain monthly limit/used into Monthly bar", () => {
    const parsed = parseGrokCliBilling(
      UNIFIED_ACTIVE_BILLING,
      SUPERGROK_USER,
      PLAIN_MONTHLY_BILLING,
    );
    expect(parsed.quotas.Monthly).toMatchObject({
      used: 6689,
      total: 20000,
    });
    expect(parsed.quotas.Monthly.remainingPercentage).toBeCloseTo(
      ((20000 - 6689) / 20000) * 100,
      5,
    );
    // Weekly product rows still present
    expect(parsed.quotas["Grok Build"]).toBeTruthy();
  });

  it("marks depleted free/promo account as exhausted (legacy onDemandCap=0)", () => {
    const parsed = parseGrokCliBilling(EXHAUSTED_BILLING, USER_PROFILE);
    expect(parsed.quotas["On-demand"].remainingPercentage).toBe(0);
    expect(parsed.exhausted).toBe(true);
  });

  it("uses subscriptionTier for plan when present", () => {
    const parsed = parseGrokCliBilling(ACTIVE_BILLING, {
      ...USER_PROFILE,
      subscriptionTier: "super_grok",
    });
    expect(parsed.plan).toBe("Super Grok");
  });

  it("humanizes XPremiumPlus plan label", () => {
    const parsed = parseGrokCliBilling(ACTIVE_BILLING, SUPERGROK_USER);
    expect(parsed.plan).toBe("X Premium Plus");
  });
});

describe("getUsageForProvider(grok-cli)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns normalized quotas from billing + user endpoints", async () => {
    // credits, plain monthly, user
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(ACTIVE_BILLING))
      .mockResolvedValueOnce(jsonResponse(PLAIN_MONTHLY_BILLING))
      .mockResolvedValueOnce(jsonResponse(USER_PROFILE));

    const usage = await getUsageForProvider({
      provider: "grok-cli",
      accessToken: "test-token",
      providerSpecificData: {
        email: "user@example.com",
        userId: "d84768dd-224d-4052-ba49-0d336fa9160c",
      },
    });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("Grok Code");
    expect(usage.quotas["On-demand"]).toMatchObject({
      used: 35,
      total: 100,
      remainingPercentage: 65,
    });
    expect(usage.quotas.Prepaid).toMatchObject({
      used: 0,
      total: 12.5,
      remainingPercentage: 100,
    });
    expect(usage.quotas.Monthly).toMatchObject({
      used: 6689,
      total: 20000,
    });

    // Official CLI fingerprint headers on credits call
    const billingCall = proxyAwareFetch.mock.calls[0];
    expect(billingCall[0]).toContain("/v1/billing");
    expect(billingCall[0]).toContain("format=credits");
    expect(billingCall[1].headers.Authorization).toBe("Bearer test-token");
    expect(billingCall[1].headers["x-xai-token-auth"]).toBe("xai-grok-cli");
    expect(billingCall[1].headers["x-userid"]).toBe(
      "d84768dd-224d-4052-ba49-0d336fa9160c",
    );

    // Plain monthly endpoint (no format=credits)
    const plainCall = proxyAwareFetch.mock.calls[1];
    expect(plainCall[0]).toMatch(/\/v1\/billing$/);
  });

  it("returns SuperGrok productUsage quotas without false exhausted bar", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(UNIFIED_ACTIVE_BILLING))
      .mockResolvedValueOnce(jsonResponse(PLAIN_MONTHLY_BILLING))
      .mockResolvedValueOnce(jsonResponse(SUPERGROK_USER));

    const usage = await getUsageForProvider({
      provider: "grok-cli",
      accessToken: "test-token",
    });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("X Premium Plus");
    expect(usage.quotas["On-demand"]).toBeUndefined();
    expect(usage.quotas["Grok Build"].remainingPercentage).toBe(55);
    expect(usage.quotas["Grok Chat"].remainingPercentage).toBe(90);
    expect(usage.quotas.Monthly.used).toBe(6689);
  });

  it("surfaces auth-expired message on 401", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401))
      .mockResolvedValueOnce(jsonResponse(PLAIN_MONTHLY_BILLING))
      .mockResolvedValueOnce(jsonResponse(USER_PROFILE));

    const usage = await getUsageForProvider({
      provider: "grok-cli",
      accessToken: "expired",
    });

    expect(usage.message).toMatch(/expired|re-authorize/i);
  });

  it("returns depleted on-demand bar without blocking message when cap is zero", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(EXHAUSTED_BILLING))
      .mockResolvedValueOnce(jsonResponse({ config: {} }))
      .mockResolvedValueOnce(jsonResponse(USER_PROFILE));

    const usage = await getUsageForProvider({
      provider: "grok-cli",
      accessToken: "test-token",
    });

    // Dashboard hides QuotaTable when `message` is set — keep message empty
    // so the 0% bar still renders for exhausted free/promo accounts.
    expect(usage.message).toBeUndefined();
    expect(usage.quotas["On-demand"].remainingPercentage).toBe(0);
    expect(usage.quotas["On-demand"].total).toBe(1);
  });
});

describe("parseQuotaData(grok-cli)", () => {
  it("forwards remainingPercentage for dashboard bars", () => {
    const rows = parseQuotaData("grok-cli", {
      plan: "Grok Code",
      quotas: {
        "Grok Build": {
          used: 45,
          total: 100,
          remainingPercentage: 55,
          resetAt: "2026-07-17T00:00:00.000Z",
        },
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Grok Build",
      used: 45,
      total: 100,
      remainingPercentage: 55,
    });
  });
});
