import { describe, expect, it } from "vitest";

// Verify combo seat limits logic filters out seats from inactive providers
describe("combo active connection seat limits", () => {
  it("filters inactive provider seats when computing combo limits", async () => {
    const { comboSeatLimits } = await import("../../src/app/api/v1/models/route.js");
    const combosByName = new Map();
    const combo = {
      name: "luna-level",
      models: ["cx/gpt-6-luna", "gemini/gemini-3.8-flash"],
    };

    // When cx is inactive, activeConnectionByProvider only contains gemini
    const activeConnectionByProvider = new Map([
      ["gemini", { id: "gemini-conn", provider: "gemini", isActive: true }],
    ]);

    const { contextWindow } = comboSeatLimits(combo, combosByName, activeConnectionByProvider);
    // cx contextWindow is 272000, gemini is 1048576
    // Since cx is inactive, it should not drag down the contextWindow to 272000
    expect(contextWindow).toBeGreaterThan(500000);
  });
});
