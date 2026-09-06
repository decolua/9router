import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import {
  USAGE_APIKEY_PROVIDERS,
  USAGE_SUPPORTED_PROVIDERS,
} from "../../src/shared/constants/providers.js";

const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("OpenCode Go registry usage flags", () => {
  it("is listed for the API key quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("opencode-go");
    expect(USAGE_APIKEY_PROVIDERS).toContain("opencode-go");
  });
});

describe("getUsageForProvider(opencode-go)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches and normalizes subscription usage", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        usage: {
          rolling: { status: "ok", percent: 13, resetsAt: "2026-09-04T14:28:02.617Z" },
          weekly: { status: "ok", percent: 5, resetsAt: "2026-09-07T00:00:00.617Z" },
          monthly: { status: "ok", percent: 2, resetsAt: "2026-10-02T12:14:24.617Z" },
        },
      }),
    );

    const usage = await getUsageForProvider({
      provider: "opencode-go",
      apiKey: "sk-go-test",
    });

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      USAGE_URL,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer sk-go-test" }),
      }),
      null,
    );
    expect(usage).toEqual({
      plan: "OpenCode Go",
      quotas: {
        Rolling: {
          used: 13,
          total: 100,
          remaining: 87,
          remainingPercentage: 87,
          resetAt: "2026-09-04T14:28:02.617Z",
          unlimited: false,
        },
        Weekly: expect.objectContaining({ used: 5, remainingPercentage: 95 }),
        Monthly: expect.objectContaining({ used: 2, remainingPercentage: 98 }),
      },
    });
  });

  it("reports missing and rejected credentials", async () => {
    const missing = await getUsageForProvider({ provider: "opencode-go" });
    expect(missing.message).toMatch(/api key/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, 401));
    const rejected = await getUsageForProvider({
      provider: "opencode-go",
      apiKey: "bad",
    });
    expect(rejected.message).toMatch(/authentication failed/i);
  });

  it("distinguishes a missing subscription from invalid credentials", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ error: { type: "EntitlementError" } }, 403),
    );

    const usage = await getUsageForProvider({
      provider: "opencode-go",
      apiKey: "sk-without-go",
    });

    expect(usage.message).toMatch(/subscription required/i);
  });

  it("rejects responses without a valid quota percentage", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ usage: { rolling: { status: "ok" }, future: { percent: 10 } } }),
    );

    const usage = await getUsageForProvider({
      provider: "opencode-go",
      apiKey: "sk-go-test",
    });

    expect(usage.quotas).toBeUndefined();
    expect(usage.message).toMatch(/valid quota data/i);
  });

  it("reports upstream and network failures", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 500));
    const upstream = await getUsageForProvider({
      provider: "opencode-go",
      apiKey: "sk-go-test",
    });
    expect(upstream.message).toContain("500");

    proxyAwareFetch.mockRejectedValueOnce(new Error("socket closed"));
    const network = await getUsageForProvider({
      provider: "opencode-go",
      apiKey: "sk-go-test",
    });
    expect(network.message).toContain("socket closed");
  });
});
