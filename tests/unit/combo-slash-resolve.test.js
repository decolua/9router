import { describe, it, expect } from "vitest";
import { getComboModelsFromData } from "../../open-sse/services/combo.js";

const combos = [
  { name: "lordx.1", models: ["openrouter/nvidia/nemotron-3-super-120b-a12b:free"] },
  { name: "my-combo", models: ["oc/deepseek-v4-flash-free"] },
];

describe("getComboModelsFromData", () => {
  it("resolves a bare combo name", () => {
    expect(getComboModelsFromData("lordx.1", combos))
      .toEqual(["openrouter/nvidia/nemotron-3-super-120b-a12b:free"]);
  });

  it("resolves a provider-prefixed combo name (openrouter/lordx.1 -> lordx.1)", () => {
    expect(getComboModelsFromData("openrouter/lordx.1", combos))
      .toEqual(["openrouter/nvidia/nemotron-3-super-120b-a12b:free"]);
  });

  it("prefers exact full-name match over basename", () => {
    const data = [
      { name: "x/y", models: ["a/m1"] },
      { name: "y", models: ["a/m2"] },
    ];
    expect(getComboModelsFromData("x/y", data)).toEqual(["a/m1"]);
  });

  it("returns null when no combo matches", () => {
    expect(getComboModelsFromData("openrouter/nonexistent", combos)).toBeNull();
    expect(getComboModelsFromData("nonexistent", combos)).toBeNull();
  });
});
