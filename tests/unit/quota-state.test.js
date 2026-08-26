import { beforeEach, describe, expect, it } from "vitest";
import {
  clearQuotaState,
  isQuotaExhausted,
  isQuotaExhaustion,
  markQuotaExhausted,
  quotaRemainingMs,
} from "../../open-sse/services/quotaState.js";

describe("quota exhaustion detection", () => {
  beforeEach(() => {
    clearQuotaState();
  });

  it("treats 402 as exhausted regardless of text", () => {
    expect(isQuotaExhaustion(402, "")).toBe(true);
  });

  it("treats a 429 that names quota or balance as exhausted", () => {
    expect(isQuotaExhaustion(429, "You exceeded your current quota")).toBe(true);
    expect(isQuotaExhaustion(429, "Insufficient Balance")).toBe(true);
    expect(isQuotaExhaustion(429, "daily limit reached")).toBe(true);
  });

  it("does NOT treat plain per-minute rate limiting as exhaustion", () => {
    expect(isQuotaExhaustion(429, "Rate limit exceeded, too many requests")).toBe(false);
    expect(isQuotaExhaustion(429, "requests per minute exceeded, slow down")).toBe(false);
  });

  it("treats a rate-limit message that also cites quota as exhaustion", () => {
    expect(isQuotaExhaustion(429, "rate limit: monthly limit reached")).toBe(true);
  });

  it("ignores unrelated statuses", () => {
    expect(isQuotaExhaustion(500, "quota")).toBe(false);
    expect(isQuotaExhaustion(400, "insufficient balance")).toBe(false);
  });
});

describe("quota exhaustion memory", () => {
  beforeEach(() => {
    clearQuotaState();
  });

  it("holds a model out for the ttl then releases it", () => {
    markQuotaExhausted("oc/x", 0, 1_000);
    expect(isQuotaExhausted("oc/x", 500)).toBe(true);
    expect(isQuotaExhausted("oc/x", 1_500)).toBe(false);
  });

  it("reports remaining time and drops expired entries", () => {
    markQuotaExhausted("oc/y", 0, 2_000);
    expect(quotaRemainingMs("oc/y", 0)).toBe(2_000);
    isQuotaExhausted("oc/y", 9_000);
    expect(quotaRemainingMs("oc/y", 0)).toBe(0);
  });

  it("treats an unknown model as available", () => {
    expect(isQuotaExhausted("oc/unknown", 0)).toBe(false);
  });
});
