import { describe, it, expect, vi, beforeEach } from "vitest";

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

const BALANCE_URL = "https://api.deepseek.com/user/balance";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ACTIVE_BALANCE = {
  is_available: true,
  balance_infos: [
    {
      currency: "USD",
      total_balance: "12.50",
      granted_balance: "2.50",
      topped_up_balance: "10.00",
    },
    {
      currency: "CNY",
      total_balance: "0.00",
      granted_balance: "0.00",
      topped_up_balance: "0.00",
    },
  ],
};

describe("deepseek registry usage flags", () => {
  it("is listed for apikey quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("deepseek");
    expect(USAGE_APIKEY_PROVIDERS).toContain("deepseek");
  });
});

describe("getUsageForProvider(deepseek)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GETs /user/balance with Bearer apiKey", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(ACTIVE_BALANCE));

    const usage = await getUsageForProvider({
      provider: "deepseek",
      apiKey: "sk-ds-test",
    });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("DeepSeek");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(BALANCE_URL);
    expect(opts.method).toBe("GET");
    expect(opts.headers.Authorization).toBe("Bearer sk-ds-test");
  });

  it("maps balances without absolute remaining (UI treats remaining as %)", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(ACTIVE_BALANCE));

    const usage = await getUsageForProvider({
      provider: "deepseek",
      apiKey: "sk-ds-test",
    });

    expect(usage.quotas["Balance (USD)"]).toMatchObject({
      used: 0,
      total: 12.5,
      remainingPercentage: 100,
    });
    expect(usage.quotas["Balance (USD)"].remaining).toBeUndefined();
    // Zero CNY still listed so user sees currency row
    expect(usage.quotas["Balance (CNY)"]).toMatchObject({
      used: 0,
      total: 0,
      remainingPercentage: 0,
    });
  });

  it("marks plan unavailable when is_available false", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        is_available: false,
        balance_infos: [
          {
            currency: "USD",
            total_balance: "0",
            granted_balance: "0",
            topped_up_balance: "0",
          },
        ],
      }),
    );

    const usage = await getUsageForProvider({
      provider: "deepseek",
      apiKey: "sk-ds-test",
    });

    expect(usage.plan).toMatch(/insufficient|unavailable/i);
    expect(usage.quotas["Balance (USD)"].remainingPercentage).toBe(0);
  });

  it("returns message on missing key / 401", async () => {
    const missing = await getUsageForProvider({ provider: "deepseek" });
    expect(missing.message).toMatch(/api key/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "no" }, 401));
    const auth = await getUsageForProvider({
      provider: "deepseek",
      apiKey: "bad",
    });
    expect(auth.message).toMatch(/auth|key|401/i);
  });
});

describe("parseQuotaData(deepseek)", () => {
  it("forwards remainingPercentage for balance rows", () => {
    const rows = parseQuotaData("deepseek", {
      plan: "DeepSeek",
      quotas: {
        "Balance (USD)": {
          used: 0,
          total: 12.5,
          remainingPercentage: 100,
        },
      },
    });
    expect(rows[0]).toMatchObject({
      name: "Balance (USD)",
      total: 12.5,
      remainingPercentage: 100,
    });
  });
});
