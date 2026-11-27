// Quota Tracker for the synthetic + deeprelay gateways. Payloads below are the
// live-probed shapes from 2026-11-11 (real key), pinned here so a vendor shape
// drift breaks the test instead of the dashboard.
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

const SYNTHETIC_URL = "https://api.synthetic.new/v2/quotas";
const DEEPRELAY_BALANCE_URL = "https://api.deeprelay.ai/v1/billing/balance";
const DEEPRELAY_USAGE_URL = "https://api.deeprelay.ai/v1/usage?bucket=day";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Verbatim answer of GET /v2/quotas for a Go-plan key (requests still at 0).
const SAMPLE_SYNTHETIC_QUOTAS = {
  subscription: {
    limit: 500,
    requests: 0,
    renewsAt: "2026-11-11T20:20:15.616Z",
  },
  search: {
    hourly: {
      limit: 250,
      requests: 0,
      renewsAt: "2026-11-11T16:20:15.616Z",
    },
  },
  planWeeklyLimit: {
    nextRegenAt: "2026-11-11T18:29:44.000Z",
    percentRemaining: 84.23147714285714,
    nextRegenPercent: 2,
  },
};

// Verbatim answer of GET /v1/billing/balance.
const SAMPLE_DEEPRELAY_BALANCE = {
  balance_cents: 445,
  balance_dollars: 4.45,
  auto_pay_enabled: false,
  auto_pay_threshold_cents: 0,
  auto_pay_amount_cents: 0,
  burn_cents_per_hour: 0,
};

// Every key probed so far answers this — the handler must then emit no spend row.
const EMPTY_DEEPRELAY_USAGE = { data: [], next_cursor: null };

describe("synthetic + deeprelay registry usage flags", () => {
  it("are listed for the apikey quota dashboard", () => {
    for (const id of ["synthetic", "deeprelay"]) {
      expect(USAGE_SUPPORTED_PROVIDERS).toContain(id);
      expect(USAGE_APIKEY_PROVIDERS).toContain(id);
    }
  });

  // opendesign-go gained its own quota tracker (see opendesign-usage.test.js);
  // the registry now carries features.usage for it, so those two lists include it.
  it("lists opendesign-go once it has a usage handler", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("opendesign-go");
    expect(USAGE_APIKEY_PROVIDERS).toContain("opendesign-go");
  });
});

describe("getUsageForProvider(synthetic)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GETs /v2/quotas with the Bearer key", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(SAMPLE_SYNTHETIC_QUOTAS));

    const usage = await getUsageForProvider({ provider: "synthetic", apiKey: "syn_key_123" });

    const [url, opts] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(SYNTHETIC_URL);
    expect(opts.method).toBe("GET");
    expect(opts.headers.Authorization).toBe("Bearer syn_key_123");
    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("Synthetic");
  });

  it("parses the subscription, hourly search and weekly rows", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(SAMPLE_SYNTHETIC_QUOTAS));

    const usage = await getUsageForProvider({ provider: "synthetic", apiKey: "syn_key_123" });

    expect(usage.quotas["Subscription"]).toEqual({
      used: 0,
      total: 500,
      remainingPercentage: 100,
      resetAt: "2026-11-11T20:20:15.616Z",
      unlimited: false,
    });
    expect(usage.quotas["Search (hourly)"]).toEqual({
      used: 0,
      total: 250,
      remainingPercentage: 100,
      resetAt: "2026-11-11T16:20:15.616Z",
      unlimited: false,
    });
    // percentRemaining is "how much is left" — it maps straight to the bar,
    // used is the complement out of 100.
    expect(usage.quotas["Weekly"]).toEqual({
      used: 15.77,
      total: 100,
      remainingPercentage: 84.23147714285714,
      resetAt: "2026-11-11T18:29:44.000Z",
      unlimited: false,
    });
  });

  it("counts used requests against the limit", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      subscription: { limit: 500, requests: 125, renewsAt: "2026-11-11T20:20:15.616Z" },
      search: { hourly: { limit: 250, requests: 250, renewsAt: "2026-11-11T16:20:15.616Z" } },
    }));

    const usage = await getUsageForProvider({ provider: "synthetic", apiKey: "syn_key_123" });

    expect(usage.quotas["Subscription"]).toMatchObject({ used: 125, total: 500, remainingPercentage: 75 });
    expect(usage.quotas["Search (hourly)"]).toMatchObject({ used: 250, total: 250, remainingPercentage: 0 });
    // No weekly window on this plan → no phantom 100% row.
    expect(usage.quotas["Weekly"]).toBeUndefined();
  });

  it("skips buckets with a zero limit instead of rendering 0/0", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      subscription: { limit: 0, requests: 0, renewsAt: "2026-11-11T20:20:15.616Z" },
    }));

    const usage = await getUsageForProvider({ provider: "synthetic", apiKey: "syn_key_123" });

    expect(usage.quotas).toEqual({});
    expect(usage.message).toMatch(/no quota data/i);
  });

  it("returns a message (no throw) on 401 and on a missing key", async () => {
    const missing = await getUsageForProvider({ provider: "synthetic" });
    expect(missing.message).toMatch(/api key/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    const unauthorized = await getUsageForProvider({ provider: "synthetic", apiKey: "bad" });
    expect(unauthorized.message).toMatch(/authentication failed/i);
    expect(unauthorized.quotas).toBeUndefined();
  });

  it("returns a message on a non-JSON body and on a network error", async () => {
    proxyAwareFetch.mockResolvedValueOnce(new Response("<html>oops</html>", { status: 200 }));
    const notJson = await getUsageForProvider({ provider: "synthetic", apiKey: "k" });
    expect(notJson.message).toMatch(/not JSON/i);

    proxyAwareFetch.mockRejectedValueOnce(new Error("ECONNRESET"));
    const network = await getUsageForProvider({ provider: "synthetic", apiKey: "k" });
    expect(network.message).toMatch(/ECONNRESET/);
  });
});

describe("getUsageForProvider(deeprelay)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the wallet balance from /v1/billing/balance", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(SAMPLE_DEEPRELAY_BALANCE))
      .mockResolvedValueOnce(jsonResponse(EMPTY_DEEPRELAY_USAGE));

    const usage = await getUsageForProvider({ provider: "deeprelay", apiKey: "deeprelay_abc" });

    expect(proxyAwareFetch.mock.calls[0][0]).toBe(DEEPRELAY_BALANCE_URL);
    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer deeprelay_abc");
    expect(usage.plan).toBe("DeepRelay");
    expect(usage.quotas["Balance ($)"]).toEqual({
      used: 0,
      total: 4.45,
      remainingPercentage: 100,
      resetAt: null,
      unlimited: false,
      unit: "USD",
    });
  });

  it("omits the spend row when /v1/usage?bucket=day is empty", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(SAMPLE_DEEPRELAY_BALANCE))
      .mockResolvedValueOnce(jsonResponse(EMPTY_DEEPRELAY_USAGE));

    const usage = await getUsageForProvider({ provider: "deeprelay", apiKey: "deeprelay_abc" });

    // burn_cents_per_hour is 0 → no burn row either. Only the balance is shown.
    expect(Object.keys(usage.quotas)).toEqual(["Balance ($)"]);
    expect(serializeQuotaNames(usage)).not.toContain("Spend");
  });

  it("sums data[].cost_cents into an unlimited Spend (30d) row", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(SAMPLE_DEEPRELAY_BALANCE))
      .mockResolvedValueOnce(jsonResponse({
        data: [
          { bucket_start: "2026-11-09T00:00:00.000Z", cost_cents: 120 },
          { bucket_start: "2026-11-10T00:00:00.000Z", cost_cents: 355 },
        ],
        next_cursor: null,
      }));

    const usage = await getUsageForProvider({ provider: "deeprelay", apiKey: "deeprelay_abc" });

    expect(usage.quotas["Spend (30d)"]).toEqual({
      used: 4.75,
      total: 0,
      remainingPercentage: 100,
      resetAt: null,
      unlimited: true,
      unit: "USD",
      windowStart: "2026-11-09T00:00:00.000Z",
    });
    expect(proxyAwareFetch.mock.calls[1][0]).toBe(DEEPRELAY_USAGE_URL);
  });

  it("adds a Burn rate ($/h) row only when the account reports burn", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ ...SAMPLE_DEEPRELAY_BALANCE, burn_cents_per_hour: 250 }))
      .mockResolvedValueOnce(jsonResponse(EMPTY_DEEPRELAY_USAGE));

    const usage = await getUsageForProvider({ provider: "deeprelay", apiKey: "deeprelay_abc" });

    expect(usage.quotas["Burn rate ($/h)"]).toEqual({
      used: 2.5,
      total: 0,
      remainingPercentage: 100,
      resetAt: null,
      unlimited: true,
      unit: "USD",
    });
  });

  it("falls back to balance_cents when balance_dollars is absent", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ balance_cents: 445 }))
      .mockResolvedValueOnce(jsonResponse(EMPTY_DEEPRELAY_USAGE));

    const usage = await getUsageForProvider({ provider: "deeprelay", apiKey: "deeprelay_abc" });

    expect(usage.quotas["Balance ($)"].total).toBe(4.45);
  });

  it("still returns the balance when the usage endpoint fails", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(SAMPLE_DEEPRELAY_BALANCE))
      .mockRejectedValueOnce(new Error("usage endpoint down"));

    const usage = await getUsageForProvider({ provider: "deeprelay", apiKey: "deeprelay_abc" });

    expect(usage.message).toBeUndefined();
    expect(usage.quotas["Balance ($)"].total).toBe(4.45);
  });

  it("explains the missing billing:read scope on a 403 insufficient_scope", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ error: { code: "insufficient_scope", message: "billing:read required" } }, 403),
    );

    const usage = await getUsageForProvider({ provider: "deeprelay", apiKey: "deeprelay_abc" });

    expect(usage.message).toMatch(/billing:read/);
    expect(usage.quotas).toBeUndefined();
  });

  it("returns a message (no throw) on 401, a 500 and a non-JSON body", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    const unauthorized = await getUsageForProvider({ provider: "deeprelay", apiKey: "deeprelay_bad" });
    expect(unauthorized.message).toMatch(/authentication failed/i);

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));
    const serverError = await getUsageForProvider({ provider: "deeprelay", apiKey: "deeprelay_abc" });
    expect(serverError.message).toMatch(/DeepRelay balance API error \(500\)/);

    proxyAwareFetch.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    const notJson = await getUsageForProvider({ provider: "deeprelay", apiKey: "deeprelay_abc" });
    expect(notJson.message).toMatch(/not JSON/i);

    const missing = await getUsageForProvider({ provider: "deeprelay", apiKey: "" });
    expect(missing.message).toMatch(/api key/i);
  });
});

describe("parseQuotaData(synthetic | deeprelay)", () => {
  it("forwards remainingPercentage and unit to the dashboard rows", async () => {
    vi.clearAllMocks();
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(SAMPLE_SYNTHETIC_QUOTAS));
    const synthetic = await getUsageForProvider({ provider: "synthetic", apiKey: "k" });

    const rows = parseQuotaData("synthetic", synthetic);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ name: "Subscription", used: 0, total: 500, remainingPercentage: 100 });
    expect(rows[2]).toMatchObject({ name: "Weekly", used: 15.77, total: 100, remainingPercentage: 84.23147714285714 });

    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ ...SAMPLE_DEEPRELAY_BALANCE, burn_cents_per_hour: 250 }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ bucket_start: "2026-11-10T00:00:00.000Z", cost_cents: 355 }],
        next_cursor: null,
      }));
    const deeprelay = await getUsageForProvider({ provider: "deeprelay", apiKey: "k" });

    const rowsDeep = parseQuotaData("deeprelay", deeprelay);
    expect(rowsDeep.map((r) => r.name)).toEqual(["Balance ($)", "Burn rate ($/h)", "Spend (30d)"]);
    expect(rowsDeep[0]).toMatchObject({ total: 4.45, unit: "USD", remainingPercentage: 100 });
    expect(rowsDeep[2]).toMatchObject({ used: 3.55, unlimited: true, unit: "USD" });
  });
});

function serializeQuotaNames(usage) {
  return Object.keys(usage.quotas || {}).join(",");
}
