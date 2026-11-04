import { describe, it, expect, beforeEach } from "vitest";

import {
  getRotatedModels,
  resetComboRotation,
  normalizeComboWeights,
} from "../../open-sse/services/combo.js";

const MODELS = ["p/a", "p/b", "p/c"];

function tallyFirst(models, name, weights, sticky, calls) {
  const counts = {};
  for (let i = 0; i < calls; i++) {
    const head = getRotatedModels(models, name, "round-robin", sticky, weights)[0];
    counts[head] = (counts[head] || 0) + 1;
  }
  return counts;
}

describe("combo weighted round-robin", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("picks in proportion to the configured weights", () => {
    const weights = { "p/a": 5, "p/b": 3, "p/c": 1 };

    expect(tallyFirst(MODELS, "weighted", weights, 1, 9)).toEqual({
      "p/a": 5,
      "p/b": 3,
      "p/c": 1,
    });
  });

  it("returns every model exactly once in every order", () => {
    const weights = { "p/a": 5, "p/b": 3, "p/c": 1 };
    const expected = [...MODELS].sort();

    for (let i = 0; i < 9; i++) {
      const order = getRotatedModels(MODELS, "weighted", "round-robin", 1, weights);
      expect(order).toHaveLength(MODELS.length);
      expect([...order].sort()).toEqual(expected);
    }
  });

  it("excludes a zero-weight model from the head but keeps it as last resort", () => {
    const weights = { "p/a": 4, "p/b": 0, "p/c": 1 };

    for (let i = 0; i < 5; i++) {
      const order = getRotatedModels(MODELS, "zero", "round-robin", 1, weights);
      expect(order[0]).not.toBe("p/b");
      expect(order[order.length - 1]).toBe("p/b");
    }
  });

  it("matches the legacy unweighted sequence exactly", () => {
    for (const sticky of [1, 2]) {
      resetComboRotation();
      const baseline = Array.from({ length: 6 }, () =>
        getRotatedModels(MODELS, "legacy", "round-robin", sticky)
      );

      resetComboRotation();
      const explicitNull = Array.from({ length: 6 }, () =>
        getRotatedModels(MODELS, "legacy", "round-robin", sticky, null)
      );

      resetComboRotation();
      const allOnes = Array.from({ length: 6 }, () =>
        getRotatedModels(MODELS, "legacy", "round-robin", sticky, { "p/a": 1, "p/b": 1, "p/c": 1 })
      );

      expect(explicitNull).toEqual(baseline);
      expect(allOnes).toEqual(baseline);
    }
  });

  it("falls back to plain rotation when every weight is zero", () => {
    const weights = { "p/a": 0, "p/b": 0, "p/c": 0 };
    const first = getRotatedModels(MODELS, "allzero", "round-robin", 1, weights);
    const second = getRotatedModels(MODELS, "allzero", "round-robin", 1, weights);

    expect(first).toEqual(MODELS);
    expect(second).toEqual(["p/b", "p/c", "p/a"]);
  });

  it("survives junk weight values without throwing", () => {
    const weights = { "p/a": -5, "p/b": "abc", "p/c": 2 };
    const order = getRotatedModels(MODELS, "junk", "round-robin", 1, weights);

    expect([...order].sort()).toEqual([...MODELS].sort());
  });

  it("clamps huge weights and terminates quickly", () => {
    const weights = { "p/a": 1e9, "p/b": 1, "p/c": 1 };
    const order = getRotatedModels(MODELS, "huge", "round-robin", 1, weights);

    expect([...order].sort()).toEqual([...MODELS].sort());
  });

  it("reuses the same head for the sticky limit before a weighted tick", () => {
    const weights = { "p/a": 2, "p/b": 1, "p/c": 1 };
    const heads = Array.from({ length: 8 }, () =>
      getRotatedModels(MODELS, "sticky", "round-robin", 2, weights)[0]
    );

    expect(heads).toEqual(["p/a", "p/a", "p/b", "p/b", "p/c", "p/c", "p/a", "p/a"]);
  });

  it("resets cleanly when the weights change mid-flight", () => {
    const before = { "p/a": 5, "p/b": 3, "p/c": 1 };
    for (let i = 0; i < 3; i++) {
      expect(getRotatedModels(MODELS, "mutable", "round-robin", 1, before)).toHaveLength(3);
    }

    const after = { "p/a": 1, "p/b": 2, "p/c": 2 };
    const order = getRotatedModels(MODELS, "mutable", "round-robin", 1, after);

    expect(MODELS).toContain(order[0]);
    expect([...order].sort()).toEqual([...MODELS].sort());
  });

  it("normalizes boundary values to the documented shape", () => {
    expect(normalizeComboWeights(MODELS, null)).toBe(null);
    expect(normalizeComboWeights(MODELS, "nope")).toBe(null);
    expect(normalizeComboWeights(MODELS, { "p/a": 1, "p/b": 1, "p/c": 1 })).toBe(null);
    expect(normalizeComboWeights(MODELS, { "p/a": 0, "p/b": 0, "p/c": 0 })).toBe(null);
    expect(normalizeComboWeights(MODELS, { "p/a": 2 })).toEqual({
      "p/a": 2,
      "p/b": 1,
      "p/c": 1,
    });
    expect(normalizeComboWeights(MODELS, { "p/a": 99999 })).toEqual({
      "p/a": 1000,
      "p/b": 1,
      "p/c": 1,
    });
  });

  it("keeps its cycle when a capacity adapter prepends a model", () => {
    const weights = { "p/a": 5, "p/b": 3, "p/c": 2 };
    const withAdapter = ["p/vision", ...MODELS];
    const heads = Array.from({ length: 20 }, (_, i) =>
      getRotatedModels(i % 2 ? MODELS : withAdapter, "adapted", "round-robin", 1, weights)[0]
    );
    const counts = {};
    for (const head of heads) counts[head] = (counts[head] || 0) + 1;

    expect(counts).toEqual({ "p/a": 10, "p/b": 6, "p/c": 4 });
    expect(heads.slice(0, 3)).toEqual(["p/a", "p/b", "p/c"]);
  });

  it("rotates after a weighted cycle ends without an explicit reset", () => {
    const weights = { "p/a": 5, "p/b": 3, "p/c": 2 };
    for (let i = 0; i < 3; i++) {
      getRotatedModels(MODELS, "handoff", "round-robin", 1, weights);
    }

    const heads = Array.from({ length: 6 }, () =>
      getRotatedModels(MODELS, "handoff", "round-robin", 1, null)[0]
    );

    expect(new Set(heads).size).toBeGreaterThan(1);
  });
});
