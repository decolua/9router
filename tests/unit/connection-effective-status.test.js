import { describe, expect, it } from "vitest";

import { getConnectionEffectiveStatus } from "../../src/lib/connectionStatus.js";

describe("getConnectionEffectiveStatus", () => {
  it("keeps unavailable when rateLimitedUntil is still active without model locks", () => {
    const connection = {
      testStatus: "unavailable",
      rateLimitedUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    };

    expect(getConnectionEffectiveStatus(connection)).toBe("unavailable");
  });

  it("returns active after unavailable cooldown has fully expired", () => {
    const connection = {
      testStatus: "unavailable",
      rateLimitedUntil: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    expect(getConnectionEffectiveStatus(connection)).toBe("active");
  });
});
