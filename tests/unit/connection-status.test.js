import { describe, expect, it } from "vitest";

import { filterActiveConnections } from "../../src/shared/utils/connectionStatus.js";

describe("filterActiveConnections", () => {
  it("excludes explicitly disabled connections", () => {
    const active = { id: "active", isActive: true };
    const legacyActive = { id: "legacy" };
    const disabled = { id: "disabled", isActive: false };

    expect(filterActiveConnections([active, disabled, legacyActive])).toEqual([
      active,
      legacyActive,
    ]);
  });

  it("returns an empty list for invalid input", () => {
    expect(filterActiveConnections()).toEqual([]);
  });
});
