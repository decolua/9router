import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { augmentModelsWithCapacityAdapter } from "../../open-sse/services/capacityAdapter.js";

describe("Kiro auto vision capabilities", () => {
  const settings = {
    capacityAdapter: {
      vision: { enabled: true, models: ["oc/mimo-v2.6-flash-free"] },
    },
  };

  it("marks kiro/auto as vision-capable", () => {
    expect(getCapabilitiesForModel("kiro", "auto").vision).toBe(true);
  });

  it("does not prepend a fallback model for kr/auto when vision is required", () => {
    const required = new Set(["vision"]);
    expect(augmentModelsWithCapacityAdapter(["kr/auto"], required, settings)).toEqual(["kr/auto"]);
    expect(augmentModelsWithCapacityAdapter(["kiro/auto"], required, settings)).toEqual(["kiro/auto"]);
  });

  it("still prepends a fallback for a non-vision kiro model", () => {
    const required = new Set(["vision"]);
    const augmented = augmentModelsWithCapacityAdapter(["kr/text-only-model"], required, settings);
    expect(augmented[0]).toBe("oc/mimo-v2.6-flash-free");
    expect(augmented).toContain("kr/text-only-model");
  });
});
