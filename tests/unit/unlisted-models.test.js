import { describe, it, expect } from "vitest";
import { unlistedLiveModels } from "@/shared/utils/unlistedModels";

/**
 * The model catalog is hand-maintained, so a model released yesterday stays
 * invisible until someone edits providerModels.js. The provider's own list has
 * been fetched on every provider page load all along and thrown away for every
 * provider except cursor and zed; this is the difference between the two, which
 * the page offers to adopt.
 */

describe("unlistedLiveModels", () => {
  it("returns what the provider has and the page does not", () => {
    expect(unlistedLiveModels({
      liveModels: [{ id: "a" }, { id: "b" }, { id: "c" }],
      listedModels: [{ id: "a" }],
      customModelRows: [{ id: "b" }],
    })).toEqual([{ id: "c", name: "c" }]);
  });

  it("keeps the provider's own order, which is usually newest first", () => {
    expect(unlistedLiveModels({
      liveModels: [{ id: "z" }, { id: "y" }, { id: "x" }],
      listedModels: [],
    }).map((m) => m.id)).toEqual(["z", "y", "x"]);
  });

  it("says nothing when everything is already listed", () => {
    expect(unlistedLiveModels({
      liveModels: [{ id: "a" }],
      listedModels: [{ id: "a" }],
    })).toEqual([]);
  });

  it("says nothing when the provider reported nothing", () => {
    // Every failure mode of the live fetch lands here: no connection, an
    // expired credential, a provider with no models endpoint at all.
    expect(unlistedLiveModels({ liveModels: [] })).toEqual([]);
    expect(unlistedLiveModels({ liveModels: null })).toEqual([]);
    expect(unlistedLiveModels({ liveModels: undefined, listedModels: [{ id: "a" }] })).toEqual([]);
  });

  it("offers a duplicate once, not twice", () => {
    expect(unlistedLiveModels({
      liveModels: [{ id: "a" }, { id: "a" }],
      listedModels: [],
    })).toEqual([{ id: "a", name: "a" }]);
  });

  it("takes the id from wherever the provider put it", () => {
    expect(unlistedLiveModels({
      liveModels: [{ name: "named-only" }, "bare-string", { id: "x", name: "Display X" }],
      listedModels: [],
    })).toEqual([
      { id: "named-only", name: "named-only" },
      { id: "bare-string", name: "bare-string" },
      { id: "x", name: "Display X" },
    ]);
  });

  it("skips an entry with no id rather than rendering a nameless button", () => {
    expect(unlistedLiveModels({
      liveModels: [{ description: "no id here" }, null, { id: "" }, { id: "real" }],
      listedModels: [],
    })).toEqual([{ id: "real", name: "real" }]);
  });

  it("treats a model listed with no id as not listed, instead of throwing", () => {
    expect(unlistedLiveModels({
      liveModels: [{ id: "a" }],
      listedModels: [{}, null],
      customModelRows: [undefined],
    })).toEqual([{ id: "a", name: "a" }]);
  });
});
