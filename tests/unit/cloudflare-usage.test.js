import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn()
}));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";
const connection = {
  provider: "cloudflare-ai",
  apiKey: "fixture-token",
  providerSpecificData: {
    accountId: "fixture-account"
  }
};
const payload = groups => ({
  data: {
    viewer: {
      accounts: [{
        aiInferenceAdaptiveGroups: groups
      }]
    }
  }
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-16T12:34:00Z"));
});
afterEach(() => vi.useRealTimers());
describe("Cloudflare Workers AI analytics", () => {
  it("uses the current schema and carries the proxy configuration", async () => {
    proxyAwareFetch.mockResolvedValue(Response.json(payload([{
      count: 4,
      sum: {
        totalNeurons: 2500
      }
    }])));
    const proxy = {
      url: "http://proxy.fixture",
      strictProxy: true
    };
    const usage = await getUsageForProvider(connection, proxy);
    const [url, init, usedProxy] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.cloudflare.com/client/v4/graphql");
    expect(usedProxy).toEqual(proxy);
    const body = JSON.parse(init.body);
    expect(body.query).toContain("$accountTag: string!");
    expect(body.query).toContain("aiInferenceAdaptiveGroups");
    expect(body.query).toContain("totalNeurons");
    expect(body.query).toContain("datetime_geq");
    expect(body.variables.since).toBe("2026-10-16T00:00:00.000Z");
    expect(init.headers.Authorization).toBe("Bearer fixture-token");
    expect(usage.quotas.neurons).toMatchObject({
      used: 2500,
      total: 10000,
      remainingPercentage: 75,
      resetAt: "2026-10-17T00:00:00.000Z"
    });
    expect(usage.quotas).not.toHaveProperty("requests");
    expect(usage.requests).toBe(4);
    expect(usage.plan).not.toContain("Free (");
    expect(parseQuotaData("cloudflare-ai", usage)[0]).toMatchObject({
      name: "Daily free allocation",
      unit: "neurons",
      used: 2500,
      total: 10000
    });
  });
  it("accepts an empty authorized dataset as zero usage", async () => {
    proxyAwareFetch.mockResolvedValue(Response.json(payload([])));
    expect((await getUsageForProvider(connection)).quotas.neurons.used).toBe(0);
  });
  it.each([{
    errors: [{
      message: "not authorized for that account"
    }],
    data: null
  }, {
    data: {
      viewer: {
        accounts: []
      }
    }
  }, payload([{
    count: 2,
    sum: {}
  }])])("never presents unavailable analytics as a zero balance", async body => {
    proxyAwareFetch.mockResolvedValue(Response.json(body));
    const usage = await getUsageForProvider(connection);
    expect(usage.message).toBeTruthy();
    expect(usage).not.toHaveProperty("quotas");
  });
  it("keeps over-allocation usage without a negative remaining percentage", async () => {
    proxyAwareFetch.mockResolvedValue(Response.json(payload([{
      count: 20,
      sum: {
        totalNeurons: 15000
      }
    }])));
    const usage = await getUsageForProvider(connection);
    expect(usage.quotas.neurons).toMatchObject({
      used: 15000,
      remainingPercentage: 0
    });
  });
  it("reports an HTTP permission error", async () => {
    proxyAwareFetch.mockResolvedValue(new Response("denied", {
      status: 403
    }));
    const usage = await getUsageForProvider(connection);
    expect(usage.message).toContain("403");
    expect(usage).not.toHaveProperty("quotas");
  });
  it("does not fetch without an account id", async () => {
    const usage = await getUsageForProvider({
      ...connection,
      providerSpecificData: {}
    });
    expect(usage.message).toContain("Account ID");
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
});
