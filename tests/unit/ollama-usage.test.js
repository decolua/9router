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

const USAGE_URL = "https://ollama.com/api/usage";
const ME_URL = "https://ollama.com/api/me";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SAMPLE_USAGE = {
  activity: {
    cost: "0.00000",
    period: {
      type: "last_4_weeks",
      starting_at: "2026-07-01T00:00:00Z",
      ending_at: "2026-07-29T00:00:00Z",
    },
    models: [],
  },
  limits: {
    session: { usage: 0, models: [] },
    weekly: {
      usage: 1,
      models: [
        { name: "glm-5.2", request_count: 5967 },
        { name: "kimi-k2.5", request_count: 2 },
      ],
    },
  },
};

// Real shape captured 2026-09: Ollama replaced session/weekly with a single
// monthly bucket.
const SAMPLE_USAGE_MONTHLY = {
  activity: {
    cost: "0.00000",
    period: {
      type: "last_4_weeks",
      starting_at: "2026-08-17T00:00:00Z",
      ending_at: "2026-09-09T13:39:08Z",
    },
    models: [],
  },
  limits: {
    monthly: {
      usage: 0.239,
      models: [{ name: "gpt-oss:20b", request_count: 2776 }],
    },
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

  it("GETs /api/usage with Bearer apiKey and POSTs /api/me for plan", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(SAMPLE_USAGE))
      .mockResolvedValueOnce(jsonResponse(SAMPLE_ME));

    const usage = await getUsageForProvider({
      provider: "ollama",
      apiKey: "k",
      providerSpecificData: {},
    });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("Max");
    expect(usage.quotas["Session (5h)"]).toMatchObject({
      used: 0,
      total: 100,
      remainingPercentage: 100,
      unlimited: false,
    });
    expect(usage.quotas["Weekly (7d)"]).toMatchObject({
      used: 100,
      total: 100,
      remainingPercentage: 0,
      unlimited: false,
    });
    // Must not set absolute remaining — UI treats remaining as %
    expect(usage.quotas["Session (5h)"].remaining).toBeUndefined();
    expect(usage.quotas["Weekly (7d)"].remaining).toBeUndefined();

    expect(proxyAwareFetch).toHaveBeenCalledTimes(2);

    const [usageUrl, usageOpts] = proxyAwareFetch.mock.calls[0];
    expect(usageUrl).toBe(USAGE_URL);
    expect(usageOpts.headers.Authorization).toBe("Bearer k");
    expect(usageOpts.headers.Accept).toBe("application/json");

    const [meUrl, meOpts] = proxyAwareFetch.mock.calls[1];
    expect(meUrl).toBe(ME_URL);
    expect(meOpts.method).toBe("POST");
    expect(meOpts.headers.Authorization).toBe("Bearer k");
    expect(meOpts.headers["Content-Length"]).toBe("0");
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

  it("parses the monthly-only limits shape (2026-09 upstream change)", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(SAMPLE_USAGE_MONTHLY))
      .mockResolvedValueOnce(jsonResponse(SAMPLE_ME));

    const usage = await getUsageForProvider({
      provider: "ollama",
      apiKey: "k",
      providerSpecificData: {},
    });

    expect(usage.message).toBeUndefined();
    expect(usage.quotas["Session (5h)"]).toBeUndefined();
    expect(usage.quotas["Weekly (7d)"]).toBeUndefined();
    expect(usage.quotas.Monthly).toMatchObject({
      used: 24,
      total: 100,
      remainingPercentage: 76,
      unlimited: false,
    });
  });

  it("still reports 'no usage limits' when neither old nor new fields are present", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ activity: {}, limits: {} }))
      .mockResolvedValueOnce(jsonResponse(SAMPLE_ME));

    const usage = await getUsageForProvider({
      provider: "ollama",
      apiKey: "k",
      providerSpecificData: {},
    });

    expect(usage.message).toMatch(/no usage limits reported/i);
    expect(usage.quotas).toEqual({});
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

  it("forwards a Monthly row the same way (2026-09 upstream shape)", () => {
    const rows = parseQuotaData("ollama", {
      plan: "Free",
      quotas: {
        Monthly: {
          used: 24,
          total: 100,
          remainingPercentage: 76,
          resetAt: null,
        },
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Monthly",
      used: 24,
      total: 100,
      remainingPercentage: 76,
    });
  });
});
