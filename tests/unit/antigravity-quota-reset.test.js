// Antigravity reports exactly when an exhausted quota comes back. Without
// reading it, the router locks the account for a generic backoff window and
// then re-tries a week-long outage every few minutes, paying seconds of latency
// each time to be told the same thing.
import { describe, it, expect } from "vitest";
import { AntigravityExecutor } from "open-sse/executors/antigravity.js";

const exec = new AntigravityExecutor();

// The real body, as captured from the live gateway.
const QUOTA_BODY = JSON.stringify({
  error: {
    code: 429,
    message: "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 162h57m59s.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "QUOTA_EXHAUSTED",
        domain: "cloudcode-pa.googleapis.com",
        metadata: {
          quotaResetTimeStamp: "2026-08-16T12:02:38Z",
          model: "gemini-3.1-pro-low",
          quotaResetDelay: "162h57m59.540174241s",
        },
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "586679.540174241s" },
    ],
  },
});

describe("antigravity quota errors carry their reset time", () => {
  it("reads the absolute reset timestamp", () => {
    const parsed = exec.parseError({ status: 429 }, QUOTA_BODY);
    expect(parsed.status).toBe(429);
    expect(parsed.resetsAtMs).toBe(Date.parse("2026-08-16T12:02:38Z"));
  });

  it("falls back to the relative delay when no timestamp is given", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        message: "Individual quota reached.",
        details: [{ "@type": "…/RetryInfo", retryDelay: "3600.5s" }],
      },
    });
    const before = Date.now();
    const parsed = exec.parseError({ status: 429 }, body);
    expect(parsed.resetsAtMs).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(parsed.resetsAtMs).toBeLessThan(before + 3_602_000);
  });

  it("parses an h/m/s duration when that is all there is", () => {
    const body = JSON.stringify({
      error: { code: 429, message: "x", details: [{ metadata: { quotaResetDelay: "2h30m10s" } }] },
    });
    const before = Date.now();
    const parsed = exec.parseError({ status: 429 }, body);
    expect(parsed.resetsAtMs).toBeGreaterThanOrEqual(before + (2 * 3600 + 30 * 60 + 10) * 1000);
  });

  it("ignores a reset time already in the past", () => {
    const body = JSON.stringify({
      error: { code: 429, details: [{ metadata: { quotaResetTimeStamp: "2020-01-01T00:00:00Z" } }] },
    });
    expect(exec.parseError({ status: 429 }, body).resetsAtMs).toBeUndefined();
  });

  it("leaves non-quota errors to the default parser", () => {
    const parsed = exec.parseError({ status: 403 }, "");
    expect(parsed.resetsAtMs).toBeUndefined();
    expect(parsed.status).toBe(403);
  });
});
