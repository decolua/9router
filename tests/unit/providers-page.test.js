import { describe, expect, it } from "vitest";

import { getStatusDisplayItems } from "../../src/app/(dashboard)/dashboard/providers/statusDisplay.js";

describe("providers page status display", () => {
  it("shows connected and error badges with canonical error tag", () => {
    const display = getStatusDisplayItems(2, 1, 3, "AUTH");
    expect(display).toEqual([
      { key: "connected", variant: "success", dot: true, label: "2 Connected" },
      { key: "error", variant: "error", dot: true, label: "1 Error (AUTH)" },
    ]);
  });

  it("shows saved badge when provider has saved connections but no eligible or error accounts", () => {
    const display = getStatusDisplayItems(0, 0, 3, null);
    expect(display).toEqual([
      { key: "saved", variant: "default", dot: false, label: "3 Saved" },
    ]);
  });
});
