import { describe, it, expect } from "vitest";
import {
  modelCandidates,
  buildComboIndex,
  comboNamesForCandidates,
  pruneMembers,
  splitModelsByComboUsage,
} from "@/shared/utils/comboModelLinks.js";

describe("modelCandidates", () => {
  it("lists every name a combo could have stored, without duplicates", () => {
    expect(modelCandidates({
      modelId: "gpt-5",
      providerId: "openrouter",
      providerStorageAlias: "or",
      providerDisplayAlias: "or",
      alias: "fast",
      fullModel: "or/gpt-5",
    })).toEqual(["or/gpt-5", "openrouter/gpt-5", "fast"]);
  });

  it("omits the alias when there is none", () => {
    expect(modelCandidates({
      modelId: "gpt-5",
      providerId: "openrouter",
      providerStorageAlias: "openrouter",
    })).toEqual(["openrouter/gpt-5"]);
  });

  it("returns nothing useful without a model id", () => {
    expect(modelCandidates({ providerId: "openrouter" })).toEqual([]);
  });
});

describe("buildComboIndex / comboNamesForCandidates", () => {
  const combos = [
    { name: "fast", models: ["or/gpt-5", "bai/m1"] },
    { name: "cheap", models: ["or/gpt-5"] },
    { name: "other", models: ["bai/m2"] },
  ];

  it("maps a member to every combo using it", () => {
    const index = buildComboIndex(combos);
    expect(comboNamesForCandidates(index, ["or/gpt-5"])).toEqual(["fast", "cheap"]);
  });

  it("dedups when two candidate names hit the same combo", () => {
    const index = buildComboIndex([{ name: "fast", models: ["or/gpt-5", "openrouter/gpt-5"] }]);
    expect(comboNamesForCandidates(index, ["or/gpt-5", "openrouter/gpt-5"])).toEqual(["fast"]);
  });

  it("returns empty for a model no combo uses", () => {
    expect(comboNamesForCandidates(buildComboIndex(combos), ["or/unused"])).toEqual([]);
  });

  it("tolerates a combo with no models", () => {
    expect(buildComboIndex([{ name: "empty", models: [] }]).size).toBe(0);
  });
});

describe("pruneMembers", () => {
  it("splits members into kept and removed, preserving order", () => {
    expect(pruneMembers(["a", "b", "c"], ["b"]))
      .toEqual({ kept: ["a", "c"], removed: ["b"] });
  });

  it("removes every matching name form", () => {
    expect(pruneMembers(["or/gpt-5", "openrouter/gpt-5", "bai/m1"], ["or/gpt-5", "openrouter/gpt-5"]))
      .toEqual({ kept: ["bai/m1"], removed: ["or/gpt-5", "openrouter/gpt-5"] });
  });

  it("matches exactly — a near miss is kept", () => {
    expect(pruneMembers(["or/gpt-5-mini"], ["or/gpt-5"]))
      .toEqual({ kept: ["or/gpt-5-mini"], removed: [] });
  });

  it("can empty the list", () => {
    expect(pruneMembers(["a"], ["a"])).toEqual({ kept: [], removed: ["a"] });
  });
});

describe("splitModelsByComboUsage", () => {
  const models = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("keeps enabled models visible", () => {
    const { visible, hidden } = splitModelsByComboUsage(models, [], () => []);
    expect(visible.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(hidden).toEqual([]);
  });

  it("hides a disabled model that no combo uses", () => {
    const { visible, hidden } = splitModelsByComboUsage(models, ["b"], () => []);
    expect(visible.map((m) => m.id)).toEqual(["a", "c"]);
    expect(hidden.map((m) => m.id)).toEqual(["b"]);
  });

  it("keeps a disabled model visible when a combo uses it", () => {
    const { visible, hidden } = splitModelsByComboUsage(
      models, ["b"], (m) => (m.id === "b" ? ["fast"] : []),
    );
    expect(visible.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(hidden).toEqual([]);
  });
});
