import { describe, expect, it } from "vitest";
import {
  checkFallbackError,
  classifyFallbackError,
} from "../../open-sse/services/accountFallback.js";

describe("fallback error scope", () => {
  it.each([
    "CONTENT_LENGTH_EXCEEDS_THRESHOLD",
    "input is too long for this model",
  ])("classifies Kiro context error as request-scoped: %s", (message) => {
    expect(classifyFallbackError(400, message)).toEqual(expect.objectContaining({
      scope: "request",
      lockAccount: false,
      accountFallback: false,
      comboFallback: true,
      cooldownMs: 0,
    }));
  });

  it("keeps the backward wrapper account-oriented", () => {
    expect(checkFallbackError(400, "CONTENT_LENGTH_EXCEEDS_THRESHOLD")).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
    });
  });

  it("keeps 429 account lock and combo fallback behavior", () => {
    expect(classifyFallbackError(429, "rate limit", 2)).toEqual(expect.objectContaining({
      scope: "account",
      lockAccount: true,
      accountFallback: true,
      comboFallback: true,
      newBackoffLevel: 3,
    }));
  });

  it("classifies unmatched 5xx as transient transport failure", () => {
    expect(classifyFallbackError(502, "socket closed")).toEqual(expect.objectContaining({
      scope: "transport",
      lockAccount: true,
      accountFallback: true,
      comboFallback: true,
    }));
  });
});
