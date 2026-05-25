import { describe, expect, it } from "vitest";
import {
  getBestQuotaRemaining,
  isQuotaCollectionDepleted,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("ProviderLimits quota helpers", () => {
  it("keeps an account available when a secondary quota pool still has capacity", () => {
    const quotas = [
      { name: "credit", used: 50, total: 50 },
      { name: "credit_freetrial", used: 0, total: 500 },
    ];

    expect(isQuotaCollectionDepleted(quotas, 5)).toBe(false);
    expect(getBestQuotaRemaining(quotas)).toBe(100);
  });

  it("marks an account depleted only when every usable pool is below the threshold", () => {
    const quotas = [
      { name: "credit", used: 50, total: 50 },
      { name: "credit_freetrial", used: 495, total: 500 },
    ];

    expect(isQuotaCollectionDepleted(quotas, 5)).toBe(true);
    expect(getBestQuotaRemaining(quotas)).toBe(1);
  });
});
