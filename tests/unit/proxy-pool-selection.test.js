import { describe, expect, it } from "vitest";
import {
  filterProxyPools, getVisibleProxyPoolSelection, updateProxyPoolSelection,
} from "@/shared/utils/proxyPoolSelection.js";

const pools = [
  { id: "a", isActive: true }, { id: "b", isActive: false },
  { id: "c", isActive: true }, { id: "d", isActive: false },
  { id: "e", isActive: false },
];

describe("proxy pool filtering and selection (#3400)", () => {
  it.each([
    ["all", ["a", "b", "c", "d", "e"]],
    ["enabled", ["a", "c"]],
    ["disabled", ["b", "d", "e"]],
  ])("filters %s pools without changing their order", (status, ids) => {
    expect(filterProxyPools(pools, status).map(pool => pool.id)).toEqual(ids);
    expect(pools.map(pool => pool.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("drops hidden and deleted pools from bulk action targets", () => {
    const visible = filterProxyPools(pools, "disabled");
    expect(getVisibleProxyPoolSelection(visible, ["a", "b", "gone", "e"]))
      .toEqual(["b", "e"]);
  });

  it.each([
    ["b", "e"], ["e", "b"],
  ])("selects the visible range from %s to %s in either direction", (anchorId, id) => {
    expect(updateProxyPoolSelection(filterProxyPools(pools, "disabled"), [], {
      anchorId, id, checked: true, shiftKey: true,
    })).toEqual(["b", "d", "e"]);
  });

  it("deselects a range while preserving selection outside it", () => {
    expect(updateProxyPoolSelection(pools, ["a", "b", "c", "d", "e"], {
      anchorId: "d", id: "b", checked: false, shiftKey: true,
    })).toEqual(["a", "e"]);
  });

  it("toggles only the clicked pool without Shift", () => {
    expect(updateProxyPoolSelection(pools, ["a"], {
      anchorId: "a", id: "e", checked: true, shiftKey: false,
    })).toEqual(["a", "e"]);
    expect(updateProxyPoolSelection(pools, ["a", "e"], {
      id: "e", checked: false,
    })).toEqual(["a"]);
  });

  it("falls back to one pool when the anchor is no longer visible", () => {
    expect(updateProxyPoolSelection(filterProxyPools(pools, "disabled"), [], {
      anchorId: "a", id: "e", checked: true, shiftKey: true,
    })).toEqual(["e"]);
  });

  it("ignores a click on a removed row and reconciles stale selection", () => {
    expect(updateProxyPoolSelection(pools, ["a", "gone"], {
      anchorId: "a", id: "gone", checked: true, shiftKey: true,
    })).toEqual(["a"]);
  });

  it("reconciles selection after a bulk enable moves rows out of the filter", () => {
    const enabled = pools.map(pool => pool.id === "b" ? { ...pool, isActive: true } : pool);
    expect(getVisibleProxyPoolSelection(filterProxyPools(enabled, "disabled"), ["b", "d"]))
      .toEqual(["d"]);
  });

  it("revalidates confirmation targets when a pending test hides a selected pool", () => {
    const selectedAtConfirmation = ["a", "c"];
    const refreshed = pools.map(pool => pool.id === "a" ? { ...pool, isActive: false } : pool);
    expect(getVisibleProxyPoolSelection(filterProxyPools(refreshed, "enabled"), selectedAtConfirmation))
      .toEqual(["c"]);
  });
});
