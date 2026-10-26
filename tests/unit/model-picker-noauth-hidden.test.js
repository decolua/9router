/**
 * Regression for #4681 (second half): the picker listed every FREE_PROVIDERS entry
 * with noAuth, including registry entries marked `hidden`.
 */
import { describe, expect, it } from "vitest";
import { selectNoAuthProviderIds } from "../../src/shared/utils/modelPickerProviders.js";

const FREE = {
  visibleFree: { id: "visibleFree", noAuth: true },
  hiddenFree: { id: "hiddenFree", noAuth: true, hidden: true },
  keyedFree: { id: "keyedFree", noAuth: false },
  hiddenKeyed: { id: "hiddenKeyed", noAuth: false, hidden: true },
};

describe("selectNoAuthProviderIds (#4681)", () => {
  it("offers no-auth providers that are visible", () => {
    expect(selectNoAuthProviderIds(FREE)).toContain("visibleFree");
  });

  it("never offers a provider the registry marks hidden", () => {
    const ids = selectNoAuthProviderIds(FREE);
    expect(ids).not.toContain("hiddenFree");
    expect(ids).not.toContain("hiddenKeyed");
  });

  it("skips providers that require a key", () => {
    expect(selectNoAuthProviderIds(FREE)).not.toContain("keyedFree");
  });

  it("tolerates a missing registry", () => {
    expect(selectNoAuthProviderIds(null)).toEqual([]);
    expect(selectNoAuthProviderIds(undefined)).toEqual([]);
  });
});
