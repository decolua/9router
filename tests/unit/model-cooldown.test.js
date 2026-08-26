import { beforeEach, describe, expect, it } from "vitest";
import {
  clearModelCooldowns,
  isModelCoolingDown,
  markModelCooldown,
  markModelCooldownFrom,
  modelCooldownRemaining,
} from "../../open-sse/services/modelCooldown.js";

describe("per-model cooldown memory", () => {
  beforeEach(() => {
    clearModelCooldowns();
  });

  it("reports a model cooling down until its window elapses", () => {
    markModelCooldown("oc/mimo", 1_000);
    expect(isModelCoolingDown("oc/mimo", 500)).toBe(true);
    expect(isModelCoolingDown("oc/mimo", 1_500)).toBe(false);
  });

  it("treats an unknown model as available", () => {
    expect(isModelCoolingDown("oc/never-seen", 0)).toBe(false);
  });

  it("derives the window from a retry-after timestamp", () => {
    const until = new Date(10_000).toISOString();
    markModelCooldownFrom("oc/a", until, null, 0);
    expect(isModelCoolingDown("oc/a", 5_000)).toBe(true);
    expect(isModelCoolingDown("oc/a", 11_000)).toBe(false);
  });

  it("derives the window from a relative cooldown", () => {
    markModelCooldownFrom("oc/b", null, 5_000, 0);
    expect(modelCooldownRemaining("oc/b", 0)).toBe(5_000);
  });

  it("keeps the longer of the two when both are supplied", () => {
    markModelCooldownFrom("oc/c", new Date(3_000).toISOString(), 9_000, 0);
    expect(modelCooldownRemaining("oc/c", 0)).toBe(9_000);
  });

  it("never shortens an existing cooldown", () => {
    markModelCooldown("oc/d", 8_000);
    markModelCooldown("oc/d", 2_000);
    expect(modelCooldownRemaining("oc/d", 0)).toBe(8_000);
  });

  it("ignores a window already in the past", () => {
    markModelCooldownFrom("oc/e", new Date(1_000).toISOString(), null, 5_000);
    expect(isModelCoolingDown("oc/e", 5_000)).toBe(false);
  });

  it("drops the entry once expired so the map stays bounded", () => {
    markModelCooldown("oc/f", 100);
    isModelCoolingDown("oc/f", 200);
    expect(modelCooldownRemaining("oc/f", 0)).toBe(0);
  });
});
