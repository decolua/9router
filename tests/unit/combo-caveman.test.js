import { describe, it, expect } from "vitest";
import { resolveCavemanSettings } from "../../open-sse/services/combo.js";

describe("per-combo caveman settings resolution", () => {
  it("inherits global settings when comboStrategies is absent or empty", () => {
    const settings = {
      cavemanEnabled: true,
      cavemanLevel: "full",
    };

    const resolved = resolveCavemanSettings(settings, "jarvis-review");
    expect(resolved).toEqual({
      cavemanEnabled: true,
      cavemanLevel: "full",
    });
  });

  it("inherits global settings when combo entry has no caveman keys", () => {
    const settings = {
      cavemanEnabled: true,
      cavemanLevel: "full",
      comboStrategies: {
        "jarvis-review": { fallbackStrategy: "fallback" },
      },
    };

    const resolved = resolveCavemanSettings(settings, "jarvis-review");
    expect(resolved).toEqual({
      cavemanEnabled: true,
      cavemanLevel: "full",
    });
  });

  it("allows per-combo cavemanEnabled=false to override global cavemanEnabled=true", () => {
    const settings = {
      cavemanEnabled: true,
      cavemanLevel: "full",
      comboStrategies: {
        "jarvis-review": { cavemanEnabled: false },
      },
    };

    const resolvedReview = resolveCavemanSettings(settings, "jarvis-review");
    expect(resolvedReview).toEqual({
      cavemanEnabled: false,
      cavemanLevel: "full",
    });

    const resolvedOrchestrator = resolveCavemanSettings(settings, "jarvis-orchestrator");
    expect(resolvedOrchestrator).toEqual({
      cavemanEnabled: true,
      cavemanLevel: "full",
    });
  });

  it("allows per-combo cavemanEnabled=true to override global cavemanEnabled=false", () => {
    const settings = {
      cavemanEnabled: false,
      cavemanLevel: "full",
      comboStrategies: {
        "jarvis-coding": { cavemanEnabled: true },
      },
    };

    const resolvedCoding = resolveCavemanSettings(settings, "jarvis-coding");
    expect(resolvedCoding).toEqual({
      cavemanEnabled: true,
      cavemanLevel: "full",
    });
  });

  it("allows per-combo cavemanLevel to override global cavemanLevel", () => {
    const settings = {
      cavemanEnabled: true,
      cavemanLevel: "full",
      comboStrategies: {
        "jarvis-scripts": { cavemanLevel: "short" },
      },
    };

    const resolved = resolveCavemanSettings(settings, "jarvis-scripts");
    expect(resolved).toEqual({
      cavemanEnabled: true,
      cavemanLevel: "short",
    });
  });

  it("resolves primary identifier before fallback identifier", () => {
    const settings = {
      cavemanEnabled: true,
      cavemanLevel: "full",
      comboStrategies: {
        "jarvis-review": { cavemanEnabled: false },
        "cx/gpt-5.6-sol": { cavemanEnabled: true },
      },
    };

    // body.model is jarvis-review, concrete model is cx/gpt-5.6-sol
    const resolved = resolveCavemanSettings(settings, "jarvis-review", "cx/gpt-5.6-sol");
    expect(resolved.cavemanEnabled).toBe(false);

    // If body.model has no entry, falls back to concrete model
    const resolvedFallback = resolveCavemanSettings(settings, "unknown-combo", "cx/gpt-5.6-sol");
    expect(resolvedFallback.cavemanEnabled).toBe(true);
  });
});
