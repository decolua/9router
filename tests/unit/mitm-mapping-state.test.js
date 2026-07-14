import { describe, expect, it } from "vitest";
import { updateMappingEntry } from "../../src/mitm/mappingState.js";

describe("MITM mapping UI state", () => {
  it("updates model and reasoning independently without mutating prior state", () => {
    const state = { flash: { model: "p/old", reasoningEffort: "high" } };
    const snapshot = structuredClone(state);
    expect(updateMappingEntry(state, "flash", { model: "p/new" })).toEqual({
      flash: { model: "p/new", reasoningEffort: "high" },
    });
    expect(state).toEqual(snapshot);
  });

  it("preserves reasoning-only mappings when model is cleared", () => {
    expect(updateMappingEntry({ flash: { model: "p/m", reasoningEffort: "low" } }, "flash", { model: "" })).toEqual({
      flash: { reasoningEffort: "low" },
    });
  });

  it("removes entries when Default clears their final field", () => {
    expect(updateMappingEntry({ flash: { reasoningEffort: "high" } }, "flash", { reasoningEffort: "" })).toEqual({});
  });
});
