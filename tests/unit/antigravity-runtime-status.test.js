import { describe, expect, it } from "vitest";
import {
  applyAntigravityRuntimeLimits,
  classifyAntigravityRuntimeError,
  extractAntigravityValidationUrl,
} from "../../open-sse/services/antigravityRuntime.js";

describe("Antigravity runtime quota status", () => {
  it("uses a model-specific runtime lock instead of the optimistic quota value", () => {
    const resetAt = "2026-07-22T07:06:58.000Z";
    const usage = {
      quotas: {
        "gemini-3.1-flash-image": {
          used: 0,
          total: 1000,
          resetAt: "2026-07-22T09:04:14.000Z",
          remainingPercentage: 99.99999,
        },
      },
    };
    const connection = {
      provider: "antigravity",
      "modelLock_gemini-3.1-flash-image": resetAt,
      "modelError_gemini-3.1-flash-image": "RESOURCE_EXHAUSTED: exhausted capacity",
      "modelErrorCode_gemini-3.1-flash-image": 429,
    };

    applyAntigravityRuntimeLimits(connection, usage, Date.parse("2026-07-22T04:30:00.000Z"));

    expect(usage.quotas["gemini-3.1-flash-image"]).toMatchObject({
      used: 1000,
      remainingPercentage: 0,
      reportedRemainingPercentage: 99.99999,
      resetAt,
      runtimeLimited: true,
      runtimeLimitLabel: "runtime limit",
    });
  });

  it("keeps validation-required accounts blocked after the short retry lock expires", () => {
    const usage = {
      quotas: {
        "gemini-3.1-flash-image": {
          used: 0,
          total: 1000,
          resetAt: "2026-07-22T09:23:59.000Z",
          remainingPercentage: 100,
        },
      },
    };
    const connection = {
      provider: "antigravity",
      antigravityValidationRequired: true,
      antigravityValidationUrl: "https://accounts.google.com/signin/continue?flowName=GlifWebSignIn",
      lastError: "Verify your account to continue. VALIDATION_REQUIRED",
      "modelLock_gemini-3.1-flash-image": "2026-07-22T04:24:00.000Z",
    };

    applyAntigravityRuntimeLimits(connection, usage, Date.parse("2026-07-22T04:30:00.000Z"));

    expect(usage.quotas["gemini-3.1-flash-image"]).toMatchObject({
      remainingPercentage: 0,
      resetAt: null,
      runtimeLimited: true,
      runtimeLimitLabel: "account blocked",
      runtimeActionUrl: connection.antigravityValidationUrl,
    });
  });

  it("only exposes trusted Google validation links", () => {
    const valid = '{"validation_url":"https://accounts.google.com/signin/continue?x=1\\u0026y=2"}';
    const invalid = '{"validation_url":"https://example.com/phishing"}';

    expect(extractAntigravityValidationUrl(valid)).toBe("https://accounts.google.com/signin/continue?x=1&y=2");
    expect(extractAntigravityValidationUrl(invalid)).toBeNull();
    expect(classifyAntigravityRuntimeError("VALIDATION_REQUIRED", 403)).toBe("account blocked");
  });
});
