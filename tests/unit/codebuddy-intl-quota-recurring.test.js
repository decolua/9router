// #4362: parseQuotaData had a dedicated `case "codebuddy-cn"` that forwards
// `recurring`, but no case for "codebuddy-intl" — which returns the exact same
// quota shape (open-sse/services/usage/codebuddy-cn.js → getCodeBuddyIntlUsage).
// Falling through to `default` dropped `recurring`, so one-shot bonus packs
// (recurring:false, resetAt = hard expiry) rendered as "Reset in" instead of
// "Expires in".
import { describe, expect, it } from "vitest";

import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const quotas = {
  Monthly: { used: 100, total: 1000, resetAt: "2026-11-01T00:00:00Z", recurring: true },
  "Bonus Pack 1": { used: 5, total: 50, resetAt: "2026-10-15T00:00:00Z", recurring: false },
};

function byName(parsed, name) {
  return parsed.find((q) => q.name === name);
}

describe("parseQuotaData forwards `recurring` for codebuddy-intl (#4362)", () => {
  it("marks a bonus pack as non-recurring, like codebuddy-cn does", () => {
    const intl = parseQuotaData("codebuddy-intl", { quotas });
    expect(byName(intl, "Bonus Pack 1").recurring).toBe(false);
    expect(byName(intl, "Monthly").recurring).toBe(true);
  });

  it("matches codebuddy-cn exactly for the same payload", () => {
    const cn = parseQuotaData("codebuddy-cn", { quotas });
    const intl = parseQuotaData("codebuddy-intl", { quotas });
    expect(intl).toEqual(cn);
  });
});
