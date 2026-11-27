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
import { getRemainingPercentage } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const USAGE_URL = "https://api.cline.bot/api/v1/users/me/plan/usage-limits";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SAMPLE_LIMITS = {
  success: true,
  data: {
    limits: [
      {
        type: "five_hour",
        percentUsed: 15,
        resetsAt: "2026-11-10T04:13:33.669456539Z",
      },
      {
        type: "weekly",
        percentUsed: 92,
        resetsAt: "2026-11-14T02:29:15.672222629Z",
      },
      {
        type: "monthly",
        percentUsed: 46,
        resetsAt: "2026-12-07T02:29:15.674628879Z",
      },
    ],
  },
};

describe("clinepass registry usage flags", () => {
  it("is listed for oauth and apikey quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("clinepass");
    expect(USAGE_APIKEY_PROVIDERS).toContain("clinepass");
  });
});

describe("getUsageForProvider(clinepass)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GETs usage-limits with WorkOS-prefixed OAuth bearer", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(SAMPLE_LIMITS));

    const usage = await getUsageForProvider({
      provider: "clinepass",
      accessToken: "eyJpeg.eyJbG.sig",
    });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("ClinePass");
    expect(proxyAwareFetch.mock.calls[0][0]).toBe(USAGE_URL);
    expect(proxyAwareFetch.mock.calls[0][1].method).toBe("GET");
    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer workos:eyJpeg.eyJbG.sig",
    );
  });

  it("keeps an existing workos: prefix on OAuth tokens", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(SAMPLE_LIMITS));

    await getUsageForProvider({
      provider: "clinepass",
      accessToken: "workos:eyJpeg.eyJbG.sig",
    });

    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer workos:eyJpeg.eyJbG.sig",
    );
  });

  it("uses plain Bearer for API keys (no workos: prefix)", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(SAMPLE_LIMITS));

    await getUsageForProvider({
      provider: "clinepass",
      apiKey: "clp_1234567890abcdef",
      accessToken: "eyJpeg.should.not.be.used",
    });

    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer clp_1234567890abcdef",
    );
  });

  it("maps percentUsed windows to remainingPercentage quotas", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(SAMPLE_LIMITS));

    const usage = await getUsageForProvider({
      provider: "clinepass",
      accessToken: "workos:eyJpeg.eyJbG.sig",
    });

    expect(usage.quotas["Session (5h)"]).toMatchObject({
      used: 15,
      total: 100,
      remainingPercentage: 85,
      resetAt: "2026-11-10T04:13:33.669Z",
    });
    expect(usage.quotas["Weekly (7d)"]).toMatchObject({
      used: 92,
      total: 100,
      remainingPercentage: 8,
    });
    expect(usage.quotas["Monthly"]).toMatchObject({
      used: 46,
      total: 100,
      remainingPercentage: 54,
    });
    // UI treats absolute remaining as % — must not set it.
    expect(usage.quotas["Session (5h)"].remaining).toBeUndefined();
  });

  it("returns auth-expired message on 401", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ error: "Unauthorized" }, 401),
    );

    const usage = await getUsageForProvider({
      provider: "clinepass",
      accessToken: "workos:dead.token",
    });

    expect(usage.quotas).toBeUndefined();
    expect(usage.message).toMatch(/authentication expired|re-authorize/i);
  });

  it("returns a soft message when no credentials are present", async () => {
    const usage = await getUsageForProvider({ provider: "clinepass" });
    expect(proxyAwareFetch).not.toHaveBeenCalled();
    expect(usage.message).toMatch(/access token or API key/i);
  });
});

describe("parseQuotaData(clinepass)", () => {
  it("forwards remainingPercentage for dashboard bars", () => {
    const rows = parseQuotaData("clinepass", {
      quotas: {
        "Session (5h)": {
          used: 15,
          total: 100,
          remainingPercentage: 85,
          resetAt: "2026-11-10T04:13:33.669Z",
        },
        "Weekly (7d)": {
          used: 92,
          total: 100,
          remainingPercentage: 8,
          resetAt: "2026-11-14T02:29:15.672Z",
        },
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: "Session (5h)",
      used: 15,
      total: 100,
      remainingPercentage: 85,
    });
    expect(getRemainingPercentage(rows[0])).toBe(85);
    expect(getRemainingPercentage(rows[1])).toBe(8);
  });
});
