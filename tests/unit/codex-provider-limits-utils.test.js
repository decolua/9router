import { describe, expect, it } from "vitest";

import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("parseQuotaData for codex", () => {
  it("returns only weekly quota when session is absent", () => {
    const result = parseQuotaData("codex", {
      quotas: {
        weekly: {
          used: 100,
          total: 100,
          remaining: 0,
          resetAt: "2026-04-25T00:00:00.000Z",
        },
      },
    });

    expect(result).toEqual([
      expect.objectContaining({ name: "weekly", used: 100, total: 100 }),
    ]);
  });
});
