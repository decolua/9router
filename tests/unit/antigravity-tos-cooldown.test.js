import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("Antigravity TOS violation and validation backoff", () => {
  it.each([
    "PERMISSION_DENIED TOS_VIOLATION: This service has been disabled in this account for violation of Terms of Service",
    "tos_violation",
  ])("sets 24h cooldown for %s under antigravity", (msg) => {
    expect(checkFallbackError(403, msg, 0, "antigravity")).toEqual({
      shouldFallback: true,
      cooldownMs: 24 * 60 * 60 * 1000,
    });
  });

  it.each([
    "PERMISSION_DENIED TOS_VIOLATION: This service has been disabled in this account for violation of Terms of Service",
    "tos_violation",
  ])("sets 24h cooldown for %s under ag alias", (msg) => {
    expect(checkFallbackError(403, msg, 0, "ag")).toEqual({
      shouldFallback: true,
      cooldownMs: 24 * 60 * 60 * 1000,
    });
  });

  it.each([
    "PERMISSION_DENIED VALIDATION_REQUIRED: Validation is required for this account",
    "validation_required",
  ])("sets 24h cooldown for %s under antigravity", (msg) => {
    expect(checkFallbackError(403, msg, 0, "antigravity")).toEqual({
      shouldFallback: true,
      cooldownMs: 24 * 60 * 60 * 1000,
    });
  });

  it("does not apply 24h cooldown for other providers on tos_violation text", () => {
    expect(checkFallbackError(403, "tos_violation", 0, "openai")).toEqual({
      shouldFallback: true,
      cooldownMs: 2 * 60 * 1000,
    });
  });

  it("still applies standard 2-minute cooldown to generic 403 on antigravity", () => {
    expect(checkFallbackError(403, "Forbidden", 0, "antigravity")).toEqual({
      shouldFallback: true,
      cooldownMs: 2 * 60 * 1000,
    });
  });
});
