import { describe, it, expect } from "vitest";
import { parseDurationMs, parseGoogleQuotaReset } from "../../open-sse/utils/googleQuota.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { BACKOFF_CONFIG, COOLDOWN_MS, MAX_RATE_LIMIT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { GeminiCLIExecutor } from "../../open-sse/executors/gemini-cli.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

// Verbatim 429 body captured from cloudcode-pa.googleapis.com via the antigravity executor.
const AG_QUOTA_BODY = JSON.stringify({
  error: {
    code: 429,
    message: "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 149h50m20s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "QUOTA_EXHAUSTED",
        domain: "cloudcode-pa.googleapis.com",
        metadata: {
          uiMessage: "true",
          model: "gemini-3-flash-agent",
          quotaResetDelay: "149h50m20.179078308s",
          quotaResetTimeStamp: "2026-08-08T17:54:07Z",
        },
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "539420.179078308s" },
    ],
  },
});

// Verbatim 402 body captured from kiro when the monthly allowance is spent.
const KIRO_MONTHLY_BODY = JSON.stringify({
  message: "You have reached the limit.",
  reason: "MONTHLY_REQUEST_COUNT",
});

describe("parseDurationMs", () => {
  it("parses protobuf Duration JSON", () => {
    expect(parseDurationMs("539420.179078308s")).toBe(539420179);
  });

  it("parses Go unit durations", () => {
    expect(parseDurationMs("149h50m20.179078308s")).toBe(539420179);
    expect(parseDurationMs("90m")).toBe(5400000);
  });

  it("returns null for junk", () => {
    expect(parseDurationMs("")).toBeNull();
    expect(parseDurationMs("soon")).toBeNull();
    expect(parseDurationMs(undefined)).toBeNull();
  });
});

describe("parseGoogleQuotaReset", () => {
  it("prefers the absolute quotaResetTimeStamp", () => {
    const now = Date.parse("2026-08-02T12:03:46Z");
    const out = parseGoogleQuotaReset(AG_QUOTA_BODY, now);
    expect(out.resetsAtMs).toBe(Date.parse("2026-08-08T17:54:07Z"));
    expect(out.reason).toBe("QUOTA_EXHAUSTED");
    expect(out.model).toBe("gemini-3-flash-agent");
    expect(out.retryAfter).toBe("539420.179078308s");
  });

  it("falls back to quotaResetDelay when the timestamp is stale", () => {
    const now = Date.parse("2027-01-01T00:00:00Z"); // timestamp already in the past
    const out = parseGoogleQuotaReset(AG_QUOTA_BODY, now);
    expect(out.resetsAtMs).toBe(now + 539420179);
  });

  it("falls back to RetryInfo when no quota metadata is present", () => {
    const now = 1000;
    const body = JSON.stringify({
      error: { details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "30s" }] },
    });
    expect(parseGoogleQuotaReset(body, now).resetsAtMs).toBe(now + 30000);
  });

  it("returns nulls for unrelated or unparseable bodies", () => {
    expect(parseGoogleQuotaReset("not json").resetsAtMs).toBeNull();
    expect(parseGoogleQuotaReset(JSON.stringify({ error: { code: 500 } })).resetsAtMs).toBeNull();
    expect(parseGoogleQuotaReset("").resetsAtMs).toBeNull();
  });
});

describe("antigravity executor parseError", () => {
  it("surfaces resetsAtMs and keeps the human message", () => {
    const out = new AntigravityExecutor().parseError({ status: 429 }, AG_QUOTA_BODY);
    expect(out.status).toBe(429);
    expect(out.resetsAtMs).toBe(Date.parse("2026-08-08T17:54:07Z"));
    expect(out.message).toContain("Individual quota reached");
  });

  it("leaves non-quota errors to the base parser", () => {
    const out = new AntigravityExecutor().parseError({ status: 500 }, "boom");
    expect(out.resetsAtMs).toBeUndefined();
    expect(out.message).toBe("boom");
  });
});

describe("gemini-cli executor parseError", () => {
  it("reports both the retry hint and the quota reset", () => {
    const out = new GeminiCLIExecutor().parseError({ status: 429 }, AG_QUOTA_BODY);
    expect(out.retryAfter).toBe("539420.179078308s");
    expect(out.resetsAtMs).toBe(Date.parse("2026-08-08T17:54:07Z"));
  });
});

describe("kiro executor parseError", () => {
  it("keeps the machine reason in the message so cooldown rules can see it", () => {
    const out = new KiroExecutor().parseError({ status: 402 }, KIRO_MONTHLY_BODY);
    expect(out.message).toBe("You have reached the limit. (MONTHLY_REQUEST_COUNT)");
  });

  it("falls back to the base parser without a reason", () => {
    const out = new KiroExecutor().parseError({ status: 403 }, "HTTP 403");
    expect(out.message).toBe("HTTP 403");
  });
});

describe("cooldown policy", () => {
  it("classifies a spent monthly allowance as a multi-hour cooldown", () => {
    const { cooldownMs } = checkFallbackError(402, "You have reached the limit. (MONTHLY_REQUEST_COUNT)");
    expect(cooldownMs).toBe(COOLDOWN_MS.monthlyQuota);
    expect(cooldownMs).toBeGreaterThan(60 * 60 * 1000);
  });

  it("still treats a bare 402 as a short cooldown", () => {
    const { cooldownMs } = checkFallbackError(402, "Payment required");
    expect(cooldownMs).toBe(2 * 60 * 1000);
  });

  it("does not truncate a provider-reported multi-day reset", () => {
    // The antigravity body above is ~150h out; the ceiling must not clip it.
    expect(MAX_RATE_LIMIT_COOLDOWN_MS).toBeGreaterThan(150 * 60 * 60 * 1000);
  });

  it("still rejects nonsense reset timestamps", () => {
    const absurd = Date.parse("9999-12-31T00:00:00Z") - Date.now();
    expect(MAX_RATE_LIMIT_COOLDOWN_MS).toBeLessThan(absurd);
  });

  it("keeps the blind backoff ladder short at the low levels", () => {
    expect(checkFallbackError(429, "rate limit", 0).cooldownMs).toBe(2000);
    expect(checkFallbackError(429, "rate limit", 1).cooldownMs).toBe(4000);
    expect(checkFallbackError(429, "rate limit", 14).cooldownMs).toBe(BACKOFF_CONFIG.max);
  });
});
