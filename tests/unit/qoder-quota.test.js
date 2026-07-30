import { describe, expect, it } from "vitest";
import { parseQuotaData } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("Qoder organization quota visibility", () => {
  const resetAt = "2026-07-31T16:00:00.000Z";

  it.each([
    ["total", { total: 1, used: 0, remaining: 0 }],
    ["used", { total: 0, used: 20000, remaining: 0 }],
    ["remaining", { total: 0, used: 0, remaining: 1 }],
  ])("keeps organization quota when %s is non-zero", (_field, organization) => {
    const data = {
      quotas: {
        user: {
          total: 3000,
          used: 3000,
          remaining: 0,
          unit: "credits",
          resetAt,
        },
        organization: {
          ...organization,
          unit: "credits",
          resetAt,
        },
      },
    };

    expect(parseQuotaData("qoder", data)).toContainEqual({
      name: "Organization",
      used: organization.used,
      total: organization.total,
      unit: "credits",
      resetAt,
    });
  });

  it("still hides an all-zero organization placeholder", () => {
    const data = {
      quotas: {
        user: { total: 3000, used: 0, remaining: 3000, unit: "credits" },
        organization: { total: 0, used: 0, remaining: 0, unit: "credits" },
      },
    };

    expect(parseQuotaData("qoder", data).map((quota) => quota.name)).toEqual([
      "Personal",
    ]);
  });

  it("keeps personal quota normalization unchanged", () => {
    const data = {
      quotas: {
        user: { total: 3000, used: 1200, remaining: 1800, unit: "credits", resetAt },
      },
    };

    expect(parseQuotaData("qoder", data)).toEqual([{
      name: "Personal",
      used: 1200,
      total: 3000,
      unit: "credits",
      resetAt,
    }]);
  });
});
