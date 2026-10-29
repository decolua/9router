import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import quotaSuccess from "../fixtures/kenari/quota-success.json";
import {
  getPricingForModel,
  KENARI_IDR_PER_USD,
  MODEL_PRICING,
} from "../../open-sse/providers/pricing.js";
import { isValidModel } from "../../src/shared/constants/models.js";
import { parseModel } from "../../open-sse/services/model.js";
import { getModelUpstreamId } from "../../open-sse/config/providerModels.js";

const QUOTA_URL = "https://kenari.id/v1/account/quota";

function response(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("kenari quota usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes the real month and week quota windows and forwards proxy options", async () => {
    const proxyOptions = { enabled: true, url: "http://proxy.test:8080" };
    proxyAwareFetch.mockResolvedValueOnce(response(quotaSuccess));

    const usage = await getUsageForProvider(
      { provider: "kenari", apiKey: "kn_test" },
      proxyOptions,
    );

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, options, forwardedProxyOptions] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(QUOTA_URL);
    expect(options).toMatchObject({
      method: "GET",
      headers: { Authorization: "Bearer kn_test", Accept: "application/json" },
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(forwardedProxyOptions).toBe(proxyOptions);
    expect(usage).toEqual({
      plan: "Kreator",
      quotas: {
        "Month (IDR)": { used: 54096, total: 600000, resetAt: "2026-09-09T05:49:05Z" },
        "Week (IDR)": { used: 54096, total: 150000, resetAt: "2026-09-09T11:00:55Z" },
      },
    });
  });

  it("returns the shared-key message without fabricating a quota", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      response({ error: "shared_key_not_allowed" }, { status: 403 }),
    );

    await expect(getUsageForProvider({ provider: "kenari", apiKey: "kn_shared" })).resolves.toEqual({
      plan: "kenari",
      message: "Balance view requires a non-shared API key",
    });
  });

  it("returns an authentication message for the real invalid-key response shape", async () => {
    proxyAwareFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "invalid key",
    });

    await expect(getUsageForProvider({ provider: "kenari", apiKey: "kn_invalid" })).resolves.toEqual({
      plan: "kenari",
      message: "Authentication failed — check your kenari API key",
    });
  });

  it("returns an unavailable message for malformed response JSON", async () => {
    proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "not json",
    });

    await expect(getUsageForProvider({ provider: "kenari", apiKey: "kn_test" })).resolves.toEqual({
      plan: "kenari",
      message: "Balance unavailable",
    });
  });

  it("returns early when no api key is supplied", async () => {
    await expect(getUsageForProvider({ provider: "kenari" })).resolves.toEqual({
      message: "API key required",
    });
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });
});

describe("kenari pricing conversion (IDR micro-units → USD/1M)", () => {
  it("converts seeded kenari models from the PROVIDER_PRICING.kenari override", () => {
    expect(KENARI_IDR_PER_USD).toBe(17500);

    expect(getPricingForModel("kenari", "step-3-7-flash")).toEqual({
      input: 0.24,
      output: 1.371429,
      cached: 0.048,
    });
    expect(getPricingForModel("kenari", "glm-5-3-flash")).toEqual({
      input: 0.000857,
      output: 0.002857,
      cached: 0.000143,
    });
    expect(getPricingForModel("kenari", "gemini-2-5-flash-lite")).toEqual({
      input: 0.022857,
      output: 0.097143,
      cached: 0.002286,
      cache_creation: 0.02,
    });
    expect(getPricingForModel("kenari", "gpt-oss-120b")).toEqual({
      input: 0.036,
      output: 0.2,
      cached: 0.0036,
    });
  });

  it("falls through to canonical MODEL_PRICING for a model absent from the kenari override", () => {
    const pricing = getPricingForModel("kenari", "gpt-4o-mini");
    expect(pricing).not.toBeNull();
    expect(pricing).toEqual(MODEL_PRICING["gpt-4o-mini"]);
  });

  it("falls through to PATTERN_PRICING for a model absent from both the kenari override and MODEL_PRICING", () => {
    expect(getPricingForModel("kenari", "gemini-9-flash")).toEqual({
      input: 0.3,
      output: 2.5,
      cached: 0.03,
      reasoning: 3.75,
      cache_creation: 0.3,
    });
  });

  it("returns null for a synthetic model matching neither canonical nor pattern", () => {
    expect(getPricingForModel("kenari", "kenari-nonexistent-synthetic-model-xyz")).toBeNull();
  });

  it("regression guard: unrelated gh override is untouched by the kenari block", () => {
    expect(getPricingForModel("gh", "gpt-5.3-codex")).toEqual({
      input: 1.75,
      output: 14,
      cached: 0.175,
      reasoning: 14,
      cache_creation: 1.75,
    });
  });
});

describe("kenari passthrough routing", () => {
  it("routes a nested unseeded model id through the passthroughModels flag", () => {
    expect(isValidModel("kenari", "vendor/new-model")).toBe(true);
    expect(isValidModel("kenari", "step-3-7-flash")).toBe(true);
  });

  it("contrast: a non-passthrough provider rejects the same unseeded id", () => {
    expect(isValidModel("groq", "vendor/new-model")).toBe(false);
  });

  it("routes a nested unseeded model id to the upstream unchanged", () => {
    expect(parseModel("kenari/vendor/new-model")).toEqual({
      provider: "kenari",
      model: "vendor/new-model",
      isAlias: false,
      providerAlias: "kenari",
    });
    expect(getModelUpstreamId("kenari", "vendor/new-model")).toBe("vendor/new-model");
  });
});
