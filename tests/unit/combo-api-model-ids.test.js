import { describe, expect, it } from "vitest";
import { normalizeComboModelIds } from "../../src/app/api/combos/modelIds.js";

describe("combo API model identifiers", () => {
  it("converts legacy TUI model objects to stable strings", () => {
    expect(normalizeComboModelIds([
      { fullModel: "ag/gemini-3.8-flash", provider: "ag", model: "other" },
      { provider: "cx", model: "gpt-6-sol" },
      "ag/claude-sonnet-4-6",
    ])).toEqual(["ag/gemini-3.8-flash", "cx/gpt-6-sol", "ag/claude-sonnet-4-6"]);
  });

  it("rejects malformed entries instead of storing React-crashing objects", () => {
    expect(normalizeComboModelIds([{ name: "unroutable" }])).toBeNull();
    expect(normalizeComboModelIds(["", "cx/gpt-6-sol"])).toBeNull();
    expect(normalizeComboModelIds({ provider: "cx" })).toBeNull();
  });
});
