import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
describe("request-scoped malformed bodies", () => {
  it("does not lock or rotate healthy accounts after Kiro REQUEST_BODY_INVALID", () => {
    expect(checkFallbackError(400, "improperly formed request: REQUEST_BODY_INVALID")).toEqual({
      shouldFallback: false,
      cooldownMs: 0
    });
  });
  it("keeps generic request-scoped 400 handling", () => {
    expect(checkFallbackError(400, "invalid model id")).toEqual({
      shouldFallback: false,
      cooldownMs: 0
    });
  });
  it.each([[401, "improperly formed request"], [403, "improperly formed request"], [429, "improperly formed request"]])("retains account fallback for %s", (status, text) => {
    const result = checkFallbackError(status, text);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });
});
