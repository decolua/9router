/**
 * Regression test for #1535:
 * The "opencode-free" suggested-models filter only kept models whose id ends
 * in "-free", which hid free-but-unsuffixed models like `big-pickle`.
 */

import { describe, it, expect } from "vitest";
import {
  SUGGESTED_MODEL_FILTERS,
  KNOWN_FREE_OPENCODE_MODELS,
} from "../../src/app/api/providers/suggested-models/filters.js";

const opencodeFree = SUGGESTED_MODEL_FILTERS["opencode-free"];

describe("opencode-free filter (#1535)", () => {
  it("includes free models that lack the -free suffix (big-pickle)", () => {
    const models = [
      { id: "some-model-free" },
      { id: "big-pickle" },
      { id: "paid-model" },
    ];
    const ids = opencodeFree(models).map((m) => m.id);
    expect(ids).toContain("big-pickle");
    expect(ids).toContain("some-model-free");
    expect(ids).not.toContain("paid-model");
  });

  it("still includes conventional -free models", () => {
    const ids = opencodeFree([{ id: "x-free" }, { id: "y-free" }]).map((m) => m.id);
    expect(ids).toEqual(["x-free", "y-free"]);
  });

  it("maps to { id, name } with id as name", () => {
    expect(opencodeFree([{ id: "big-pickle" }])).toEqual([
      { id: "big-pickle", name: "big-pickle" },
    ]);
  });

  it("is null-safe for entries without an id", () => {
    expect(opencodeFree([{}, { id: "big-pickle" }]).map((m) => m.id)).toEqual(["big-pickle"]);
  });

  it("exposes big-pickle as a known free model", () => {
    expect(KNOWN_FREE_OPENCODE_MODELS.has("big-pickle")).toBe(true);
  });
});
