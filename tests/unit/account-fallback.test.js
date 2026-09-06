import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("account fallback classification", () => {
  it("does not switch accounts for deterministic client request errors", () => {
    expect(checkFallbackError(400, "Improperly formed request."))
      .toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(checkFallbackError(422, "Failed to deserialize request"))
      .toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("still switches accounts for capacity errors returned with a client status", () => {
    expect(checkFallbackError(400, "Selected model is at capacity").shouldFallback).toBe(true);
    expect(checkFallbackError(422, "Rate limit reached").shouldFallback).toBe(true);
  });
});
