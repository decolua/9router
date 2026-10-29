import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import {
  USAGE_SUPPORTED_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
} from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const BALANCE_URL = "https://ollama.com/api/balance";
const ME_URL = "https://ollama.com/api/me";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Real shape captured 2026-10 after Ollama's credit-model pricing migration:
// GET /api/usage became pure spend-history and quota moved to /api/balance.
const SAMPLE_BALANCE = {
  included: {
    balance_usd: 72.5,
    allowance_usd: 100,
    period: { from: "2026-10-01T00:00:00Z", until: "2026-11-01T00:00:00Z" },
  },
};

const SAMPLE_BALANCE_FREE = {
  included: {
    balance_usd: 4.9,
    allowance_usd: 5,
    period: { from: "2026-10-01T00:00:00Z", until: "2026-11-01T00:00:00Z" },
  },
};

const SAMPLE_BALANCE_WITH_PURCHASED = {
  included: {
    balance_usd: 10,
    allowance_usd: 100,
    period: { from: "2026-10-01T00:00:00Z", until: "2026-11-01T00:00:00Z" },
  },
  purchased: { balance_usd: 25 },
};

// Legacy shape still returned by accounts not yet migrated to the credit model.
const SAMPLE_BALANCE_LEGACY = {
  included: {
    session: { remaining_percent: 100, resets_at: "2026-10-22T20:00:00Z" },
    weekly: { remaining_percent: 0, resets_at: "2026-10-27T00:00:00Z" },
  },
};

const SAMPLE_ME = {
  Plan: "max",
};

describe("ollama registry usage flags", () => {
  it("is listed for apikey quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("ollama");
    expect(USAGE_APIKEY_PROVIDERS).toContain("ollama");
  });
});

describe("getUsageForProvider(ollama)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GETs /api/balance with Bearer apiKey and POSTs /api/me for plan", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(SAMPLE_BALANCE))
      .mockResolvedValueOnce(jsonResponse(SAMPLE_ME));

    const usage = await getUsageForProvider({
      provider: "ollama",
      apiKey: "k",
      providerSpecificData: {},
    });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("Max");
    expect(usage.quotas.Monthly).toMatchObject({
      used: 27.5,
      total: 100,
      remainingPercentage: 72.5,
      resetAt: "2026-11-01T00:00:00Z",
      unlimited: false,
    });
    // Must not set absolute remaining — UI treats remaining as %
    expect(usage.quotas.Monthly.remaining).toBeUndefined();

    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);

    const [balanceUrl, balanceOpts] = proxyAwareFetch.mock.calls[0];
    expect(balanceUrl).toBe(BALANCE_URL);
    expect(balanceOpts.headers.Authorization).toBe("Bearer k");
    expect(balanceOpts.headers.Accept).toBe("application/json");

    const [meUrl, meOpts] = proxyAwareFetch.mock.calls[1];
    expect(meUrl).toBe(ME_URL);
    expect(meOpts.method).toBe("POST");
    expect(meOpts.headers.Authorization).toBe("Bearer k");
    expect(meOpts.headers["Content-Length"]).toBe("0");
  });

  it("maps the free plan's monthly credit balance", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(SAMPLE_BALANCE_FREE))
      .mockResolvedValueOnce(jsonResponse({ Plan: "free" }));

    const usage = await getUsageForProvider({
      provider: "ollama",
      apiKey: "k",
      providerSpecificData: {},
    });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("Free");
    expect(Object.keys(usage.quotas)).toEqual(["Monthly"]);
    expect(usage.quotas.Monthly).toMatchObject({
      used: 0.1,
      total: 5,
      remainingPercentage: 98,
      resetAt: "2026-11-01T00:00:00Z",
      unlimited: false,
    });
    expect(usage.quotas.Monthly.remaining).toBeUndefined();
  });

  it("surfaces an unexpired purchased top-up as a credit balance row", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(SAMPLE_BALANCE_WITH_PURCHASED))
      .mockResolvedValueOnce(jsonResponse(SAMPLE_ME));

    const usage = await getUsageForProvider({
      provider: "ollama",
      apiKey: "k",
      providerSpecificData: {},
    });

    expect(usage.quotas.Monthly).toBeDefined();
    expect(usage.quotas["Purchased credit"]).toMatchObject({
      total: 25,
      isCreditBalance: true,
      currency: "USD",
    });
  });

  it("falls back to the legacy session/weekly percent shape", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(SAMPLE_BALANCE_LEGACY))
      .mockResolvedValueOnce(jsonResponse(SAMPLE_ME));

    const usage = await getUsageForProvider({
      provider: "ollama",
      apiKey: "k",
      providerSpecificData: {},
    });

    expect(usage.message).toBeUndefined();
    expect(usage.quotas["Session (5h)"]).toMatchObject({
      used: 0,
      total: 100,
      remainingPercentage: 100,
      resetAt: "2026-10-22T20:00:00Z",
      unlimited: false,
    });
    expect(usage.quotas["Weekly (7d)"]).toMatchObject({
      used: 100,
      total: 100,
      remainingPercentage: 0,
      resetAt: "2026-10-27T00:00:00Z",
      unlimited: false,
    });
  });

  it("reports no limits when neither included nor purchased balance is present", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ Plan: "free" }));

    const usage = await getUsageForProvider({
      provider: "ollama",
      apiKey: "k",
      providerSpecificData: {},
    });

    expect(usage.message).toMatch(/no usage limits/i);
    expect(usage.quotas).toEqual({});
  });

  it("surfaces invalid key message on 401", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ error: "unauthorized" }, 401),
    );

    const usage = await getUsageForProvider({
      provider: "ollama",
      apiKey: "bad",
    });

    expect(usage.message).toMatch(/invalid/i);
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("returns message when apiKey missing", async () => {
    const usage = await getUsageForProvider({
      provider: "ollama",
      providerSpecificData: {},
    });

    expect(usage.message).toMatch(/api key/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

});

describe("parseQuotaData(ollama)", () => {
  it("forwards remainingPercentage for dashboard bars", () => {
    const rows = parseQuotaData("ollama", {
      plan: "Max",
      quotas: {
        "Session (5h)": {
          used: 0,
          total: 100,
          remainingPercentage: 100,
          resetAt: null,
        },
        "Weekly (7d)": {
          used: 100,
          total: 100,
          remainingPercentage: 0,
          resetAt: null,
        },
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "Session (5h)",
      used: 0,
      total: 100,
      remainingPercentage: 100,
    });
    expect(rows[1]).toMatchObject({
      name: "Weekly (7d)",
      used: 100,
      total: 100,
      remainingPercentage: 0,
    });
  });

  it("forwards credit and purchased balance rows for dashboard display", () => {
    const rows = parseQuotaData("ollama", {
      plan: "Free",
      quotas: {
        Monthly: { used: 24, total: 100, remainingPercentage: 76, resetAt: null },
        "Allowance ($)": { used: 1.25, total: 2.5, remainingPercentage: 50, resetAt: "2026-11-01T00:00:00Z", unlimited: false, unit: "USD" },
        "Purchased Credits": { used: 0, total: 10, remainingPercentage: 100, isCreditBalance: true, currency: "$" },
      },
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ name: "Monthly", used: 24, total: 100, remainingPercentage: 76 });
    expect(rows[1]).toMatchObject({ name: "Allowance ($)", used: 1.25, total: 2.5, remainingPercentage: 50, unit: "USD" });
    expect(rows[2]).toMatchObject({ name: "Purchased Credits", used: 0, total: 10, remainingPercentage: 100, isCreditBalance: true, currency: "$" });
  });
});
