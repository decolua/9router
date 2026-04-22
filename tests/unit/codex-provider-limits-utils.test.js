import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getStoredQuotaPresentation,
  parseQuotaData,
  parseStoredUsageSnapshot,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("parseQuotaData for codex", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("parses stored usage snapshots from merged connection state", () => {
    const connection = {
      id: "conn-1",
      provider: "codex",
      usageSnapshot: JSON.stringify({
        plan: "Pro",
        quotas: {
          weekly: {
            used: 25,
            total: 100,
            remaining: 75,
            resetAt: "2026-04-25T00:00:00.000Z",
          },
        },
      }),
    };

    expect(parseStoredUsageSnapshot(connection)).toMatchObject({
      plan: "Pro",
      quotas: {
        weekly: expect.objectContaining({ used: 25, total: 100 }),
      },
    });

    expect(getStoredQuotaPresentation(connection)).toMatchObject({
      plan: "Pro",
      hasSnapshot: true,
      quotas: [
        expect.objectContaining({ name: "weekly", used: 25, total: 100 }),
      ],
    });
  });

  it("returns an empty presentation when snapshot JSON is invalid", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const connection = {
      id: "conn-2",
      provider: "codex",
      usageSnapshot: "{bad-json",
    };

    expect(parseStoredUsageSnapshot(connection)).toBeNull();
    expect(getStoredQuotaPresentation(connection)).toEqual({
      quotas: [],
      plan: null,
      message: null,
      raw: null,
      hasSnapshot: false,
    });
    expect(warnSpy).toHaveBeenCalled();
  });
});
