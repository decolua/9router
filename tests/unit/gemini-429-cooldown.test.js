import { describe, expect, it, vi, beforeEach } from "vitest";
import { parseRetryDelayToMs, parseGeminiRetryDelayMs, randomGeminiNoHintCooldownMs, hasDailyQuotaViolation, resolveGeminiCooldownMs } from "../../open-sse/utils/geminiRetry.js";
import { GEMINI_RETRY } from "../../open-sse/config/errorConfig.js";

const authMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

const SAMPLE_429 = JSON.stringify({
  error: {
    code: 429,
    message: "You exceeded your current quota, please check your plan and billing details. Please retry in 22.231358113s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      { "@type": "type.googleapis.com/google.rpc.Help", links: [] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "22s" },
    ],
  },
});

describe("parseRetryDelayToMs", () => {
  it.each([
    ["22s", 22000],
    ["22.231358113s", 22231],
    ["500ms", 500],
    ["2m", 120000],
    ["1.5h", 5400000],
    ["1d", 86400000],
  ])("parses %s → %sms", (raw, ms) => {
    expect(parseRetryDelayToMs(raw)).toBe(ms);
  });

  it.each([[""], ["soon"], [null], [undefined], ["-5s"]])("returns null for %s", (raw) => {
    expect(parseRetryDelayToMs(raw)).toBeNull();
  });
});

describe("parseGeminiRetryDelayMs", () => {
  it("prefers details[].RetryInfo.retryDelay", () => {
    expect(parseGeminiRetryDelayMs(SAMPLE_429)).toBe(22000);
  });

  it("falls back to 'Please retry in Xs' when details are absent", () => {
    const body = JSON.stringify({ error: { code: 429, message: "Quota exceeded. Please retry in 16.79s.", status: "RESOURCE_EXHAUSTED" } });
    expect(parseGeminiRetryDelayMs(body)).toBe(16790);
  });

  it("returns null when no hint is present", () => {
    expect(parseGeminiRetryDelayMs(JSON.stringify({ error: { code: 429, message: "Rate limit exceeded" } }))).toBeNull();
    expect(parseGeminiRetryDelayMs("")).toBeNull();
    expect(parseGeminiRetryDelayMs(null)).toBeNull();
  });
});

describe("randomGeminiNoHintCooldownMs", () => {
  it("lands in the 1-3h window", () => {
    for (let i = 0; i < 50; i++) {
      const ms = randomGeminiNoHintCooldownMs();
      expect(ms).toBeGreaterThanOrEqual(GEMINI_RETRY.noHintMinMs);
      expect(ms).toBeLessThan(GEMINI_RETRY.noHintMaxMs);
    }
  });
});

const PER_DAY_429 = JSON.stringify({
  error: {
    code: 429,
    message: "You exceeded your current quota. Please retry in 16.79s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "16s" },
    ],
  },
});

const PER_MINUTE_429 = JSON.stringify({
  error: {
    code: 429,
    message: "Please retry in 16.79s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "16s" },
    ],
  },
});

describe("hasDailyQuotaViolation", () => {
  it("detects PerDay quotaIds", () => {
    expect(hasDailyQuotaViolation(PER_DAY_429)).toBe(true);
    expect(hasDailyQuotaViolation(PER_MINUTE_429)).toBe(false);
    expect(hasDailyQuotaViolation("")).toBe(false);
    expect(hasDailyQuotaViolation(null)).toBe(false);
  });
});

describe("resolveGeminiCooldownMs", () => {
  it("parks 1-3h on daily exhaustion despite a seconds-scale retryDelay", () => {
    for (let i = 0; i < 20; i++) {
      const ms = resolveGeminiCooldownMs(PER_DAY_429);
      expect(ms).toBeGreaterThanOrEqual(GEMINI_RETRY.noHintMinMs);
      expect(ms).toBeLessThan(GEMINI_RETRY.noHintMaxMs);
    }
  });

  it("honors retryDelay for pure per-minute rate limiting", () => {
    expect(resolveGeminiCooldownMs(PER_MINUTE_429)).toBe(16000);
  });

  it("parks 1-3h when there is no hint", () => {
    const ms = resolveGeminiCooldownMs("[429] Rate limit exceeded");
    expect(ms).toBeGreaterThanOrEqual(GEMINI_RETRY.noHintMinMs);
    expect(ms).toBeLessThan(GEMINI_RETRY.noHintMaxMs);
  });
});

describe("GeminiExecutor.parseError", () => {
  it("returns resetsAtMs from RetryInfo on 429", async () => {
    const { GeminiExecutor } = await import("../../open-sse/executors/gemini.js");
    const ex = new GeminiExecutor();
    const parsed = ex.parseError({ status: 429 }, SAMPLE_429);
    expect(parsed.status).toBe(429);
    expect(parsed.resetsAtMs).toBeGreaterThan(Date.now());
    expect(parsed.resetsAtMs - Date.now()).toBeLessThanOrEqual(23000);
    expect(parsed.message).toContain("current quota");
  });

  it("parks 1-3h on 429 with no hint", async () => {
    const { GeminiExecutor } = await import("../../open-sse/executors/gemini.js");
    const ex = new GeminiExecutor();
    const parsed = ex.parseError({ status: 429 }, JSON.stringify({ error: { message: "Rate limit exceeded" } }));
    const delta = parsed.resetsAtMs - Date.now();
    expect(delta).toBeGreaterThanOrEqual(GEMINI_RETRY.noHintMinMs - 1000);
    expect(delta).toBeLessThan(GEMINI_RETRY.noHintMaxMs + 1000);
  });

  it("leaves non-429 errors alone", async () => {
    const { GeminiExecutor } = await import("../../open-sse/executors/gemini.js");
    const ex = new GeminiExecutor();
    const parsed = ex.parseError({ status: 400 }, "bad request");
    expect(parsed.resetsAtMs).toBeUndefined();
  });
});

describe("markAccountUnavailable parks the whole gemini key", () => {
  beforeEach(() => {
    vi.resetModules();
    authMocks.getProviderConnections.mockReset();
    authMocks.updateProviderConnection.mockReset();
  });

  async function loadAuth() {
    vi.doMock("../../src/lib/localDb.js", () => ({
      getProviderConnections: authMocks.getProviderConnections,
      validateApiKey: vi.fn(),
      updateProviderConnection: authMocks.updateProviderConnection,
      getSettings: vi.fn(),
      getProxyPools: vi.fn(),
    }));
    return import("../../src/sse/services/auth.js");
  };

  it("sets modelLock___all + per-model lock from RetryInfo, untruncated", async () => {
    authMocks.getProviderConnections.mockResolvedValue([{ id: "conn1", backoffLevel: 0 }]);
    const { markAccountUnavailable } = await loadAuth();
    const { shouldFallback, cooldownMs } = await markAccountUnavailable("conn1", 429, SAMPLE_429, "gemini", "gemini-3.8-flash");
    expect(shouldFallback).toBe(true);
    expect(cooldownMs).toBeGreaterThan(21000);
    expect(cooldownMs).toBeLessThanOrEqual(22000);
    const update = authMocks.updateProviderConnection.mock.calls[0][1];
    expect(update["modelLock_gemini-3.8-flash"]).toBeTruthy();
    expect(update[Object.keys(update).find((k) => k === "modelLock___all")]).toBeTruthy();
    expect(update.testStatus).toBe("unavailable");
    expect(update.errorCode).toBe(429);
  });

  it("parks 1-3h account-wide when the 429 carries no hint", async () => {
    authMocks.getProviderConnections.mockResolvedValue([{ id: "conn1", backoffLevel: 0 }]);
    const { markAccountUnavailable } = await loadAuth();
    const { shouldFallback, cooldownMs } = await markAccountUnavailable(
      "conn1", 429, "[429] Rate limit exceeded", "gemini", "gemini-3.8-flash"
    );
    expect(shouldFallback).toBe(true);
    expect(cooldownMs).toBeGreaterThanOrEqual(GEMINI_RETRY.noHintMinMs);
    expect(cooldownMs).toBeLessThan(GEMINI_RETRY.noHintMaxMs);
    const update = authMocks.updateProviderConnection.mock.calls[0][1];
    expect(update["modelLock___all"]).toBeTruthy();
  });

  it("escalates daily exhaustion to 1-3h even with a short provided resetsAtMs", async () => {
    authMocks.getProviderConnections.mockResolvedValue([{ id: "conn1", backoffLevel: 0 }]);
    const { markAccountUnavailable } = await loadAuth();
    const { shouldFallback, cooldownMs } = await markAccountUnavailable(
      "conn1", 429, PER_DAY_429, "gemini", "gemini-3.8-flash", Date.now() + 16000
    );
    expect(shouldFallback).toBe(true);
    expect(cooldownMs).toBeGreaterThanOrEqual(GEMINI_RETRY.noHintMinMs);
    expect(cooldownMs).toBeLessThan(GEMINI_RETRY.noHintMaxMs);
    const update = authMocks.updateProviderConnection.mock.calls[0][1];
    expect(update["modelLock___all"]).toBeTruthy();
    expect(update["modelLock_gemini-3.8-flash"]).toBeTruthy();
  });
});
