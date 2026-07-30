import { describe, expect, it } from "vitest";
import {
  getRemainingPercentage,
  parseQuotaData,
} from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("Qoder organization quota visibility", () => {
  const resetAt = "2026-07-31T16:00:00.000Z";

  it.each([
    ["total", { total: 1, used: 0, remaining: 0 }, 1],
    ["used", { total: 0, used: 20000, remaining: 0 }, 20000],
    ["remaining", { total: 0, used: 0, remaining: 1 }, 1],
    ["invalid total", { total: -1, used: 3804, remaining: 6196 }, 10000],
  ])("keeps organization quota when %s is non-zero", (_field, organization, expectedTotal) => {
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
      total: expectedTotal,
      unit: "credits",
      resetAt,
    });
  });

  it("infers a finite organization total from used and remaining credits", () => {
    const data = {
      quotas: {
        organization: {
          total: 0,
          used: 3804,
          remaining: 6196,
          unit: "credits",
          resetAt,
        },
      },
    };

    const [organization] = parseQuotaData("qoder", data);

    expect(organization).toEqual({
      name: "Organization",
      used: 3804,
      total: 10000,
      unit: "credits",
      resetAt,
    });
    expect(getRemainingPercentage(organization)).toBe(62);
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
