import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("request replay fallback classification", () => {
  it("does not lock an account for Envoy request replay buffer overflow", () => {
    expect(checkFallbackError(507, "[507]: exceeded request buffer limit while retrying upstream"))
      .toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(checkFallbackError(507, "Insufficient storage").shouldFallback).toBe(true);
  });
});
