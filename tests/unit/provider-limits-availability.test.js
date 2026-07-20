import { describe, expect, it } from "vitest";

import {
  classifyConnectionAvailability,
  getUsageMaxFromDayBars,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const connection = { id: "connection-1" };

function entry(quotas, message = null) {
  return { quotas, message };
}

describe("classifyConnectionAvailability", () => {
  it("marks a finite quota above the threshold as available", () => {
    expect(
      classifyConnectionAvailability(
        connection,
        entry([{ used: 40, total: 100 }]),
      ),
    ).toBe("available");
  });

  it("marks a finite quota at or below the threshold as empty", () => {
    expect(
      classifyConnectionAvailability(
        connection,
        entry([{ used: 95, total: 100 }]),
      ),
    ).toBe("empty");
  });

  it("lets a depleted constraint win over another available row", () => {
    expect(
      classifyConnectionAvailability(
        connection,
        entry([
          { used: 10, total: 100 },
          { used: 99, total: 100 },
        ]),
      ),
    ).toBe("empty");
  });

  it("marks explicit unlimited quota as available", () => {
    expect(
      classifyConnectionAvailability(
        connection,
        entry([{ used: 0, total: 0, unlimited: true }]),
      ),
    ).toBe("available");
  });

  it.each([
    ["missing payload", undefined, {}],
    ["message only", entry([], "No numeric quota"), {}],
    ["ambiguous 0/0", entry([{ used: 0, total: 0 }]), {}],
    ["loading", entry([{ used: 0, total: 100 }]), { loading: true }],
    ["error", entry([{ used: 0, total: 100 }]), { error: "failed" }],
  ])("marks %s as unknown", (_label, quotaEntry, meta) => {
    expect(
      classifyConnectionAvailability(connection, quotaEntry, meta),
    ).toBe("unknown");
  });
});

describe("getUsageMaxFromDayBars", () => {
  it("uses tokens and returns one for empty input", () => {
    expect(getUsageMaxFromDayBars()).toBe(1);
    expect(
      getUsageMaxFromDayBars({
        a: [{ tokens: 100 }, { tokens: 250 }],
        b: [{ tokens: 175 }],
      }),
    ).toBe(250);
  });
}
);
