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

const MGMT_BASE = "https://api.tokenrouter.com/api/management";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const WALLET = {
  data: {
    topUpBalance: 70,
    toppedUpSpent: 0,
    voucherEfficientAmount: 30.019508,
    voucherSpent: 0.000492,
  },
};

const KEYS_PAGE = {
  data: {
    page: 1,
    page_size: 10,
    total: 1,
    items: [
      {
        name: "dasep",
        key: "sk-GDZ0t6b2SSSVsq0w98GmfS419sfRtPDmOH5Ua8FBUjGJfRa8",
        status: 1,
        unlimited_quota: true,
        remain_quota: -0.000492,
        used_quota: 0.000492,
        expired_time: -1,
        created_time: 1785861287,
      },
    ],
  },
};

describe("tokenrouter registry usage flags", () => {
  it("is listed for apikey quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("tokenrouter");
    expect(USAGE_APIKEY_PROVIDERS).toContain("tokenrouter");
  });
});

describe("getUsageForProvider(tokenrouter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GETs wallet + api-keys with Bearer management key", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(WALLET))
      .mockResolvedValueOnce(jsonResponse(KEYS_PAGE));

    const usage = await getUsageForProvider({
      provider: "tokenrouter",
      providerSpecificData: { managementKey: "sk-mgmt-test" },
    });

    expect(usage.message).toBeUndefined();
    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);

    const [walletUrl, walletOpts] = proxyAwareFetch.mock.calls[0];
    expect(walletUrl).toBe(`${MGMT_BASE}/self/wallet`);
    expect(walletOpts.headers.Authorization).toBe("Bearer sk-mgmt-test");

    const [keysUrl] = proxyAwareFetch.mock.calls[1];
    expect(keysUrl).toBe(`${MGMT_BASE}/api-keys?page=1&page_size=100`);
  });

  it("maps account wallet + unlimited key rows", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(WALLET))
      .mockResolvedValueOnce(jsonResponse(KEYS_PAGE));

    const usage = await getUsageForProvider({
      provider: "tokenrouter",
      providerSpecificData: { managementKey: "sk-mgmt-test" },
    });

    expect(usage.plan).toBe("TokenRouter");

    // Wallet row
    expect(usage.quotas["Account Balance"]).toMatchObject({
      used: 0,
      total: 100.019508,
      unlimited: false,
    });

    // Unlimited key row: no absolute remaining (null → UI falls back to 100%)
    expect(usage.quotas["Key: dasep"]).toMatchObject({
      used: 0.000492,
      total: 0,
      remaining: null,
      remainingPercentage: 100,
      unlimited: true,
      status: "enabled",
      expiresAt: null,
    });
  });

  it("returns message when management key is missing", async () => {
    const usage = await getUsageForProvider({
      provider: "tokenrouter",
      providerSpecificData: {},
    });

    expect(usage.message).toMatch(/management key/i);
    expect(usage.quotas).toEqual({});
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("returns message on 401 (invalid management key)", async () => {
    // Wallet call fails silently (best-effort), then api-keys 401 surfaces the auth message.
    proxyAwareFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 401 }));

    const usage = await getUsageForProvider({
      provider: "tokenrouter",
      providerSpecificData: { managementKey: "sk-bad" },
    });

    expect(usage.message).toMatch(/invalid|expired/i);
  });
});

describe("parseQuotaData(tokenrouter)", () => {
  it("forwards unlimited/status and drops null remaining", () => {
    const rows = parseQuotaData("tokenrouter", {
      quotas: {
        "Key: dasep": {
          used: 0.000492,
          total: 0,
          remaining: null,
          remainingPercentage: 100,
          unlimited: true,
          status: "enabled",
        },
      },
    });

    expect(rows[0]).toMatchObject({
      name: "Key: dasep",
      total: 0,
      remainingPercentage: 100,
      unlimited: true,
      status: "enabled",
    });
    // null remaining must not be forwarded (getRemainingPercentage would round it to 0%)
    expect(rows[0].remaining).toBeUndefined();
  });

  it("forwards numeric remaining for limited keys", () => {
    const rows = parseQuotaData("tokenrouter", {
      quotas: {
        "Key: prod": {
          used: 2.5,
          total: 10,
          remaining: 7.5,
          remainingPercentage: 75,
          unlimited: false,
          status: "enabled",
        },
      },
    });

    expect(rows[0].remaining).toBe(7.5);
    expect(rows[0].unlimited).toBe(false);
  });
});