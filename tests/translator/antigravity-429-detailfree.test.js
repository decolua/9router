// Antigravity 429 classification: a detail-free QUOTA_EXHAUSTED is request-shape
// bucketing, not exhausted quota. Cooling the account on it drops a healthy
// connection from rotation and the client retry storm then burns real quota.
import { describe, it, expect } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const detailFree429 = {
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message: "Resource has been exhausted (e.g. check quota).",
  },
};

const quotaWithErrorInfo = {
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message: "Quota exhausted",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "QUOTA_EXHAUSTED",
        metadata: {
          quotaResetDelay: "32m35s",
          quotaResetTimeStamp: new Date(Date.now() + 32 * 60 * 1000).toISOString(),
        },
      },
    ],
  },
};

const quotaWithRetryInfo = {
  error: {
    code: 429,
    status: "RESOURCE_EXHAUSTED",
    message: "Rate limited",
    details: [
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "7s" },
    ],
  },
};

describe("checkFallbackError — detail-free 429", () => {
  it("does not cool the account when no quota metadata is present", () => {
    const r = checkFallbackError(429, JSON.stringify(detailFree429), 0, "antigravity", {
      noQuotaMetadata: true,
    });
    expect(r.shouldFallback, "healthy account must not be removed from rotation").toBe(false);
    expect(r.cooldownMs).toBe(0);
    expect(r.requestScoped).toBe(true);
    expect(r.classifiedAs).toBe("detailFreeQuota");
  });

  it("treats 409 the same way (same bucketing shape)", () => {
    const r = checkFallbackError(409, JSON.stringify(detailFree429), 0, "antigravity", {
      noQuotaMetadata: true,
    });
    expect(r.shouldFallback).toBe(false);
    expect(r.requestScoped).toBe(true);
  });

  it("still cools the account when the 429 states its reset (ErrorInfo)", () => {
    const r = checkFallbackError(429, JSON.stringify(quotaWithErrorInfo), 0, "antigravity", {});
    expect(r.shouldFallback, "real quota exhaustion must still fail over").toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("still cools the account when the 429 carries RetryInfo", () => {
    const r = checkFallbackError(429, JSON.stringify(quotaWithRetryInfo), 0, "antigravity", {});
    expect(r.shouldFallback).toBe(true);
  });

  it("keeps legacy behaviour when no meta is passed at all", () => {
    const withMeta = checkFallbackError(429, JSON.stringify(detailFree429), 0, "antigravity", {});
    expect(withMeta.shouldFallback, "callers that pass no meta keep the old path").toBe(true);
  });

  it("ignores the detail-free flag on a non-429/409 status", () => {
    const r = checkFallbackError(500, "boom", 0, "antigravity", { noQuotaMetadata: true });
    expect(r.classifiedAs).not.toBe("detailFreeQuota");
  });
});
