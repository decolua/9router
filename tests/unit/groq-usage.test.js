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

const MODELS_URL = "https://api.groq.com/openai/v1/models";

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

const RATE_LIMIT_HEADERS = {
  "x-ratelimit-limit-requests": "14400",
  "x-ratelimit-remaining-requests": "14370",
  "x-ratelimit-reset-requests": "2m59.56s",
  "x-ratelimit-limit-tokens": "18000",
  "x-ratelimit-remaining-tokens": "17997",
  "x-ratelimit-reset-tokens": "7.66s",
};

describe("groq registry usage flags", () => {
  it("is listed for apikey quota dashboard", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("groq");
    expect(USAGE_APIKEY_PROVIDERS).toContain("groq");
  });
});

describe("getUsageForProvider(groq)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GETs the models endpoint with Bearer apiKey", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      response({ data: [] }, { headers: RATE_LIMIT_HEADERS }),
    );

    const usage = await getUsageForProvider({
      provider: "groq",
      apiKey: "gsk_test",
    });

    expect(usage.message).toBeUndefined();
    expect(usage.plan).toBe("Groq");
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(MODELS_URL);
    expect(opts.method).toBe("GET");
    expect(opts.headers.Authorization).toBe("Bearer gsk_test");
  });

  it("parses request + token rate-limit headers into quotas", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      response({ data: [] }, { headers: RATE_LIMIT_HEADERS }),
    );

    const usage = await getUsageForProvider({
      provider: "groq",
      apiKey: "gsk_test",
    });

    expect(usage.quotas["Requests"]).toMatchObject({
      used: 30,
      total: 14400,
      unlimited: false,
    });
    expect(usage.quotas["Tokens"]).toMatchObject({
      used: 3,
      total: 18000,
      unlimited: false,
    });
    // Duration-string reset headers resolve to a real future ISO timestamp.
    expect(new Date(usage.quotas["Requests"].resetAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(usage.quotas["Tokens"].resetAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns a soft message (not an error) when no rate-limit headers are present", async () => {
    proxyAwareFetch.mockResolvedValueOnce(response({ data: [] }));

    const usage = await getUsageForProvider({
      provider: "groq",
      apiKey: "gsk_test",
    });

    expect(usage.error).toBeUndefined();
    expect(usage.message).toMatch(/no rate-limit data/i);
    expect(usage.quotas).toEqual({});
  });

  it("returns message on missing key / 401", async () => {
    const missing = await getUsageForProvider({ provider: "groq" });
    expect(missing.message).toMatch(/api key/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();

    proxyAwareFetch.mockResolvedValueOnce(response({ error: "invalid_api_key" }, { status: 401 }));
    const auth = await getUsageForProvider({ provider: "groq", apiKey: "bad" });
    expect(auth.message).toMatch(/auth|key/i);
  });
});

describe("parseQuotaData(groq)", () => {
  it("forwards used/total/resetAt for the dashboard table", () => {
    const rows = parseQuotaData("groq", {
      plan: "Groq",
      quotas: {
        Requests: { used: 30, total: 14400, resetAt: "2026-01-01T00:03:00.000Z" },
        Tokens: { used: 3, total: 18000, resetAt: "2026-01-01T00:00:08.000Z" },
      },
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Requests", used: 30, total: 14400 });
    expect(rows[1]).toMatchObject({ name: "Tokens", used: 3, total: 18000 });
  });
});
