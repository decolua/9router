import { describe, it, expect, beforeEach } from "vitest";

import {
  findComboCycle,
  getRotatedModels,
  resetComboRotation,
  validateComboAcyclic,
} from "../../open-sse/services/combo.js";

describe("combo round-robin routing", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("keeps existing one-request round-robin behavior by default", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 4 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin")[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-b",
      "provider/model-a",
      "provider/model-b",
    ]);
  });

  it("sticks to each combo model for the configured number of requests", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 6 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-a",
      "provider/model-b",
      "provider/model-b",
      "provider/model-a",
      "provider/model-a",
    ]);
  });

  it("tracks sticky rotation independently per combo", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-b");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
  });

  it("does not rotate fallback combos", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
  });
});

describe("combo cycle validation", () => {
  it("detects a direct self-reference", () => {
    const validation = validateComboAcyclic({
      name: "my-combo",
      models: ["my-combo"],
      combosData: [],
    });

    expect(validation.valid).toBe(false);
    expect(validation.error).toBe("Combo circular dependency detected: my-combo -> my-combo");
  });

  it("detects an indirect cycle through another combo", () => {
    const validation = validateComboAcyclic({
      name: "alpha",
      models: ["beta"],
      combosData: [
        { id: "b", name: "beta", models: ["gamma"] },
        { id: "g", name: "gamma", models: ["alpha"] },
      ],
    });

    expect(validation.valid).toBe(false);
    expect(validation.error).toBe("Combo circular dependency detected: alpha -> beta -> gamma -> alpha");
  });

  it("allows provider models and non-cyclic combo chains", () => {
    const validation = validateComboAcyclic({
      name: "alpha",
      models: ["beta", "openai/gpt-5"],
      combosData: [
        { id: "b", name: "beta", models: ["anthropic/claude-sonnet"] },
      ],
    });

    expect(validation).toEqual({ valid: true, error: null });
  });

  it("can scan an existing combo graph", () => {
    const cycle = findComboCycle([
      { id: "a", name: "alpha", models: ["beta"] },
      { id: "b", name: "beta", models: ["alpha"] },
    ]);

    expect(cycle).toEqual(["alpha", "beta", "alpha"]);
  });
});
