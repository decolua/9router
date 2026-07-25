import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { USAGE_SUPPORTED_PROVIDERS } from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Mirrors the real coding/v1/usages response: a top-level weekly allowance plus
// exactly one rolling window in `limits` (the 300-minute session).
const USAGE_RESPONSE = {
  usage: {
    limit: "2048",
    used: "375",
    remaining: "1673",
    resetTime: "2026-08-01T15:23:13.373Z",
  },
  limits: [
    {
      window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
      detail: {
        limit: "200",
        used: "19",
        remaining: "181",
        resetTime: "2026-08-01T15:05:24.374Z",
      },
    },
  ],
};

describe("Kimi usage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes the OAuth subscription usage endpoint", () => {
    expect(PROVIDERS.kimi.usage?.url).toBe("https://api.kimi.com/coding/v1/usages");
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("kimi");
  });

  it("normalizes every valid Kimi quota window and sends identity headers", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(USAGE_RESPONSE));

    const usage = await getUsageForProvider({
      provider: "kimi",
      accessToken: "test-token",
      providerSpecificData: { deviceId: "test-device" },
    });

    expect(usage).toMatchObject({
      plan: "Kimi Code",
      quotas: {
        "weekly (7d)": {
          used: 375,
          total: 2048,
          resetAt: "2026-08-01T15:23:13.373Z",
        },
        "session (5h)": {
          used: 19,
          total: 200,
          resetAt: "2026-08-01T15:05:24.374Z",
        },
      },
    });

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://api.kimi.com/coding/v1/usages",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          Accept: "application/json",
          "X-Msh-Device-Id": "test-device",
        }),
      }),
      null,
    );
  });

  it("does not duplicate the weekly row when limits restates the 7-day window", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      ...USAGE_RESPONSE,
      limits: [
        ...USAGE_RESPONSE.limits,
        {
          window: { duration: 7, timeUnit: "TIME_UNIT_DAY" },
          detail: { limit: "2048", used: "375", resetTime: "2026-08-01T15:23:13.373Z" },
        },
      ],
    }));

    const usage = await getUsageForProvider({ provider: "kimi", accessToken: "test-token" });

    expect(Object.keys(usage.quotas)).toEqual(["weekly (7d)", "session (5h)"]);
  });

  it("keeps valid quotas when neighboring records are malformed", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      usage: { limit: "unknown", used: "1", resetTime: "2026-08-01T00:00:00Z" },
      limits: [
        {
          window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
          detail: { limit: "bad", used: "1", resetTime: "2026-08-01T00:00:00Z" },
        },
        {
          window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
          detail: { limit: "20", used: "1", resetTime: "2026-08-01T00:00:00Z" },
        },
      ],
    }));

    const usage = await getUsageForProvider({ provider: "kimi", accessToken: "test-token" });

    expect(usage.quotas).toEqual({
      "session (5h)": {
        used: 1,
        total: 20,
        resetAt: "2026-08-01T00:00:00.000Z",
      },
    });
  });

  it("keeps a quota whose reset time is missing", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      usage: { limit: "2048", used: "375" },
    }));

    const usage = await getUsageForProvider({ provider: "kimi", accessToken: "test-token" });

    expect(usage.quotas).toEqual({
      "weekly (7d)": { used: 375, total: 2048, resetAt: null },
    });
  });

  it("names an hour-expressed session window as session (5h)", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({
      limits: [
        {
          window: { duration: 5, timeUnit: "TIME_UNIT_HOUR" },
          detail: { limit: "200", used: "19", resetTime: "2026-08-01T15:05:24.374Z" },
        },
      ],
    }));

    const usage = await getUsageForProvider({ provider: "kimi", accessToken: "test-token" });

    expect(Object.keys(usage.quotas)).toEqual(["session (5h)"]);
  });

  it.each([401, 403])("returns an auth-expiry message on %i", async (status) => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, status));

    const usage = await getUsageForProvider({ provider: "kimi", accessToken: "expired" });

    expect(usage.message).toMatch(/authentication expired/i);
  });

  it("does not leak parser internals when the body is not JSON", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      new Response("<html>gateway</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const usage = await getUsageForProvider({ provider: "kimi", accessToken: "test-token" });

    expect(usage.message).toBe("Kimi connected. Unable to parse quota data.");
  });

  it("returns the standard failure message for unavailable usage fetches", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "unavailable" }, 503));

    const usage = await getUsageForProvider({ provider: "kimi", accessToken: "test-token" });

    expect(usage.message).toBe("Kimi connected. Unable to fetch usage (503).");
  });

  it("parses standard Kimi quotas for the dashboard", () => {
    const rows = parseQuotaData("kimi", {
      quotas: {
        "weekly (7d)": { used: 375, total: 2048, resetAt: "2026-08-01T15:23:13.373Z" },
      },
    });

    expect(rows).toEqual([
      {
        name: "weekly (7d)",
        used: 375,
        total: 2048,
        resetAt: "2026-08-01T15:23:13.373Z",
      },
    ]);
  });
});
