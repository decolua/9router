import { describe, it, expect } from "vitest";
import { MODEL_PRICING } from "../../src/shared/constants/pricing.js";

describe("MiniMax-M3 pricing", () => {
  it("includes MiniMax-M3 in MODEL_PRICING", () => {
    expect(MODEL_PRICING["MiniMax-M3"]).toBeDefined();
  });

  it("MiniMax-M3 pricing has numeric shape (input, output, cached)", () => {
    const pricing = MODEL_PRICING["MiniMax-M3"];
    expect(pricing).toMatchObject({
      input: expect.any(Number),
      output: expect.any(Number),
      cached: expect.any(Number),
    });
  });

  it("MiniMax-M3 input price matches the design spec (0.30)", () => {
    expect(MODEL_PRICING["MiniMax-M3"].input).toBe(0.30);
  });

  it("MiniMax-M3 output price matches the design spec (1.20)", () => {
    expect(MODEL_PRICING["MiniMax-M3"].output).toBe(1.20);
  });

  it("MiniMax-M3 cached price matches the design spec (0.06)", () => {
    expect(MODEL_PRICING["MiniMax-M3"].cached).toBe(0.06);
  });
});