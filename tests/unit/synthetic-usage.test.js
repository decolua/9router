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
import { PROVIDERS } from "../../open-sse/config/providers.js";

const QUOTAS_URL = "https://api.synthetic.new/v2/quotas";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("synthetic registry usage flags", () => {
  it("is listed for apikey quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("synthetic");
    expect(USAGE_APIKEY_PROVIDERS).toContain("synthetic");
  });

  it("validates keys against /v2/quotas, not the public model catalog", () => {
    // /openai/v1/models answers 200 for any Bearer value, so it cannot reject a bad key.
    expect(PROVIDERS.synthetic.validateUrl).toBe(QUOTAS_URL);
  });
});

describe("getUsageForProvider(synthetic)", () => {
  beforeEach(() => {
    vi.mocked(proxyAwareFetch).mockReset();
  });

  it("maps subscription quota", async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValue(
      jsonResponse({ subscription: { limit: 135, requests: 35, renewsAt: "2026-12-01T00:00:00.000Z" } }),
    );
    const out = await getUsageForProvider({ provider: "synthetic", apiKey: "syn_key" });
    const [url, opts] = vi.mocked(proxyAwareFetch).mock.calls[0];
    expect(url).toBe(QUOTAS_URL);
    expect(opts.headers.Authorization).toBe("Bearer syn_key");
    expect(out.plan).toBe("Synthetic");
    expect(out.quotas.Requests).toMatchObject({
      used: 35, total: 135, remaining: 100, percentage: 26, resetAt: "2026-12-01T00:00:00.000Z",
    });
  });

  it("reports auth failure", async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValue(jsonResponse({}, 401));
    const out = await getUsageForProvider({ provider: "synthetic", apiKey: "bad" });
    expect(out.message).toMatch(/authentication failed/i);
  });

  it("reports non-auth HTTP errors", async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValue(jsonResponse({}, 500));
    const out = await getUsageForProvider({ provider: "synthetic", apiKey: "k" });
    expect(out.plan).toBe("Synthetic");
    expect(out.message).toMatch(/\(500\)/);
  });

  it("does not report unlimited when the limit is missing or zero", async () => {
    for (const body of [{ subscription: {} }, { subscription: { limit: 0, requests: 0 } }]) {
      vi.mocked(proxyAwareFetch).mockResolvedValue(jsonResponse(body));
      const out = await getUsageForProvider({ provider: "synthetic", apiKey: "k" });
      expect(out.quotas).toBeUndefined();
      expect(out.message).toMatch(/no synthetic subscription quota/i);
    }
  });

  it("handles a body without a subscription object", async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValue(jsonResponse({ unexpected: true }));
    const out = await getUsageForProvider({ provider: "synthetic", apiKey: "k" });
    expect(out.quotas).toBeUndefined();
    expect(out.message).toMatch(/no subscription quota/i);
  });

  it("returns a plan-tagged message when the fetch throws", async () => {
    vi.mocked(proxyAwareFetch).mockImplementation(async () => { throw new Error("boom"); });
    const out = await getUsageForProvider({ provider: "synthetic", apiKey: "k" });
    expect(out).toEqual({ plan: "Synthetic", message: "Synthetic error: boom" });
  });

  it("asks for a key when missing", async () => {
    const out = await getUsageForProvider({ provider: "synthetic" });
    expect(out.message).toMatch(/not available/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
});
