import { describe, expect, it } from "vitest";

import {
  getRemainingPercentage,
  parseQuotaData,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("quota remaining percentage normalization", () => {
  it("prefers provider-supplied remainingPercentage over used/total math", () => {
    expect(getRemainingPercentage({
      used: 0,
      total: 1000,
      remainingPercentage: 64,
    })).toBe(64);
  });

  it("preserves Antigravity remainingPercentage for the dashboard cards and table", () => {
    const quotas = parseQuotaData("antigravity", {
      quotas: {
        "gemini-3-pro": {
          displayName: "Gemini 3 Pro",
          used: 0,
          total: 1000,
          remainingPercentage: 42,
          resetAt: "2026-06-26T20:00:00.000Z",
        },
      },
    });

    expect(quotas).toHaveLength(1);
    expect(quotas[0].remainingPercentage).toBe(42);
    expect(getRemainingPercentage(quotas[0])).toBe(42);
  });
});
