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
import {
  parseQuotaData,
  getRemainingPercentage,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Mirrors the upstream route (anomalyco/opencode
// packages/console/app/src/routes/zen/go/v1/usage.ts): every window carries
// status + a floored 0..100 percent + an ISO resetsAt, and all three are
// always emitted.
const FULL_USAGE = {
  usage: {
    rolling: { status: "ok", percent: 12, resetsAt: "2026-08-15T18:00:00.000Z" },
    weekly: { status: "ok", percent: 47, resetsAt: "2026-08-20T00:00:00.000Z" },
    monthly: { status: "rate-limited", percent: 100, resetsAt: "2026-09-01T00:00:00.000Z" },
  },
};

describe("opencode-go registry usage flags", () => {
  it("is listed for the apikey quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("opencode-go");
    expect(USAGE_APIKEY_PROVIDERS).toContain("opencode-go");
  });

  it("carries the usage endpoint in the registry, not in the fetcher", async () => {
    const registry = (await import("../../open-sse/providers/registry/opencode-go.js")).default;
    expect(registry.transport.usage.url).toBe(USAGE_URL);
  });
});

describe("getUsageForProvider(opencode-go)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GETs the usage endpoint with the Bearer apiKey", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(FULL_USAGE));

    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "oc-test" });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("OpenCode Go");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(USAGE_URL);
    expect(opts.method).toBe("GET");
    expect(opts.headers.Authorization).toBe("Bearer oc-test");
  });

  it("maps each window to a percent bar with the remainder derived", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(FULL_USAGE));

    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "oc-test" });

    expect(usage.quotas.Rolling).toMatchObject({ used: 12, total: 100, remainingPercentage: 88 });
    expect(usage.quotas.Weekly).toMatchObject({ used: 47, total: 100, remainingPercentage: 53 });
    expect(usage.quotas.Monthly).toMatchObject({ used: 100, total: 100, remainingPercentage: 0 });
    expect(usage.quotas.Weekly.resetAt).toBe("2026-08-20T00:00:00.000Z");
  });

  // Labels stay duration-free: weekly resets on a calendar week boundary and
  // monthly on the subscription anniversary, so "7d"/"30d" would be wrong.
  it("labels windows without asserting a span", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(FULL_USAGE));

    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "oc-test" });

    expect(Object.keys(usage.quotas)).toEqual(["Rolling", "Weekly", "Monthly"]);
  });

  it("skips a window it cannot read instead of emitting a 0% bar", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ usage: { rolling: { percent: 5 }, weekly: null, monthly: { percent: "n/a" } } }),
    );

    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "oc-test" });

    expect(Object.keys(usage.quotas)).toEqual(["Rolling"]);
    expect(usage.quotas.Rolling.resetAt).toBeNull();
  });

  it("clamps a percentage outside 0..100", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ usage: { weekly: { percent: 130 } } }));

    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "oc-test" });

    expect(usage.quotas.Weekly).toMatchObject({ used: 100, remainingPercentage: 0 });
  });

  it("reports rather than throws when the payload carries no window", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ usage: {} }));

    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "oc-test" });

    expect(usage.quotas).toEqual({});
    expect(usage.message).toMatch(/no quota windows/i);
  });

  it("returns a message on a missing key and never calls out", async () => {
    const missing = await getUsageForProvider({ provider: "opencode-go" });
    expect(missing.message).toMatch(/api key/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("calls 401 an invalid key", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ type: "error", error: { type: "AuthError", message: "Unauthorized" } }, 401),
    );

    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "bad" });

    expect(usage.message).toMatch(/invalid or expired/i);
  });

  // Upstream answers 403 EntitlementError when the key is fine but the account
  // has no Go plan. Calling that an invalid key sends the user to reissue a
  // working one.
  it("reports 403 as a missing subscription, not a bad key", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse(
        { type: "error", error: { type: "EntitlementError", message: "OpenCode Go subscription required." } },
        403,
      ),
    );

    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "oc-test" });

    expect(usage.message).toBe("OpenCode Go subscription required.");
    expect(usage.message).not.toMatch(/invalid|expired/i);
  });

  it("surfaces the upstream error message rather than the JSON envelope", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ type: "error", error: { type: "ServerError", message: "upstream unavailable" } }, 503),
    );

    const usage = await getUsageForProvider({ provider: "opencode-go", apiKey: "oc-test" });

    expect(usage.message).toContain("503");
    expect(usage.message).toContain("upstream unavailable");
    expect(usage.message).not.toContain("{");
  });

  it("returns a message on a non-JSON body and on a transport failure", async () => {
    proxyAwareFetch.mockResolvedValueOnce(new Response("<html>gateway</html>", { status: 200 }));
    const garbled = await getUsageForProvider({ provider: "opencode-go", apiKey: "oc-test" });
    expect(garbled.message).toMatch(/not json/i);

    proxyAwareFetch.mockRejectedValueOnce(new Error("socket hang up"));
    const down = await getUsageForProvider({ provider: "opencode-go", apiKey: "oc-test" });
    expect(down.message).toMatch(/socket hang up/i);
  });
});

describe("parseQuotaData(opencode-go)", () => {
  const RAW = {
    plan: "OpenCode Go",
    quotas: {
      Rolling: { used: 12, total: 100, remainingPercentage: 88, resetAt: null },
      Monthly: { used: 90, total: 100, remainingPercentage: 10, resetAt: null },
    },
  };

  it("forwards remainingPercentage for every window", () => {
    const rows = parseQuotaData("opencode-go", RAW);

    expect(rows.map((r) => r.name)).toEqual(["Rolling", "Monthly"]);
    expect(rows[0]).toMatchObject({ total: 100, remainingPercentage: 88 });
    expect(rows[1]).toMatchObject({ total: 100, remainingPercentage: 10 });
  });

  // The rendered number is what matters, and QuotaTable derives it through
  // getRemainingPercentage — pin that, not just the field being present.
  it("renders the remaining percentage the provider reported", () => {
    const rows = parseQuotaData("opencode-go", RAW);

    expect(rows.map(getRemainingPercentage)).toEqual([88, 10]);
  });
});
