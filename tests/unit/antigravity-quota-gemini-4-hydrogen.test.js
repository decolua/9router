import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { _clearWeeklyCache } from "../../open-sse/services/usage/antigravity-weekly.js";
import {
  getAntigravityModelFamily,
  getAntigravityModelQuota,
} from "../../src/sse/services/antigravityQuota.js";

// Shape of a paid-tier account's live catalog: Hydrogen tiers share the main
// "Gemini Models" pool with 3.8 Flash, while Argon keeps its own weekly bucket.
const HYDROGEN_QUOTA = { remainingFraction: 0.25, resetTime: "2026-11-15T02:57:08Z" };
const CATALOG = {
  models: {
    "gemini-4-hydrogen-xhigh": { displayName: "Gemini 4 Hydrogen (XHigh)", quotaInfo: HYDROGEN_QUOTA },
    "gemini-4-hydrogen-high": { displayName: "Gemini 4 Hydrogen (High)", quotaInfo: HYDROGEN_QUOTA },
    "gemini-4-hydrogen-medium": { displayName: "Gemini 4 Hydrogen (Medium)", quotaInfo: HYDROGEN_QUOTA },
    "gemini-4-hydrogen-low": { displayName: "Gemini 4 Hydrogen (Low)", quotaInfo: HYDROGEN_QUOTA },
    "gemini-3.8-flash-high": { displayName: "Gemini 3.8 Flash (High)", quotaInfo: HYDROGEN_QUOTA },
    "gemini-4-argon-high": { displayName: "Gemini 4 Argon (High)", quotaInfo: { remainingFraction: 1, resetTime: "2026-11-22T02:24:34Z" } },
  },
};
const SUMMARY = {
  groups: [
    {
      displayName: "Gemini Models",
      description: "Models within this group: Gemini 4 Hydrogen, Gemini 3.8 Flash",
      buckets: [
        { bucketId: "gemini-weekly", window: "weekly", remainingFraction: 0.9, resetTime: "2026-11-21T00:05:12Z" },
        { bucketId: "gemini-5h", window: "5h", remainingFraction: 0.25, resetTime: "2026-11-15T02:57:08Z" },
      ],
    },
    {
      displayName: "Gemini 4 Argon",
      buckets: [{ bucketId: "gemini-argon-wtu-weekly", window: "weekly", remainingFraction: 1, resetTime: "2026-11-22T02:24:35Z" }],
    },
  ],
};

describe("Gemini 4 Hydrogen Antigravity quota", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    _clearWeeklyCache();
  });

  it("tracks every Hydrogen tier from fetchAvailableModels", async () => {
    proxyAwareFetch.mockImplementation(async (url) => {
      if (url.includes(":loadCodeAssist")) {
        return { ok: true, status: 200, json: async () => ({ cloudaicompanionProject: "p1", paidTier: { id: "g1-pro-tier" } }) };
      }
      if (url.includes(":fetchAvailableModels")) return { ok: true, status: 200, json: async () => CATALOG };
      if (url.includes(":retrieveUserQuotaSummary")) return { ok: true, status: 200, json: async () => SUMMARY };
      return { ok: false, status: 404 };
    });

    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const { quotas } = await getAntigravityUsage("token", {});

    for (const id of ["gemini-4-hydrogen-xhigh", "gemini-4-hydrogen-high", "gemini-4-hydrogen-medium", "gemini-4-hydrogen-low"]) {
      expect(quotas[id]).toMatchObject({ used: 750, total: 1000, remainingPercentage: 25 });
    }
    expect(quotas.gemini_session).toMatchObject({ remainingPercentage: 25 });
    expect(quotas.gemini_argon_weekly).toMatchObject({ remainingPercentage: 100 });
  });

  it("belongs to the shared Gemini family, not Argon's bucket", () => {
    expect(getAntigravityModelFamily("gemini-4-hydrogen")).toBe("gemini");
    expect(getAntigravityModelFamily("ag/gemini-4-hydrogen-xhigh")).toBe("gemini");
  });

  it("blocks Hydrogen when the shared Gemini 5h pool is exhausted", () => {
    const resetAt = new Date(Date.now() + 3600_000).toISOString();
    const quotas = {
      "gemini-4-hydrogen-high": { remainingPercentage: 40, resetAt },
      gemini_session: { remainingPercentage: 0, resetAt, displayName: "Gemini (5h)" },
      gemini_argon_weekly: { remainingPercentage: 100, resetAt },
    };
    expect(getAntigravityModelQuota(quotas, "gemini-4-hydrogen-xhigh")).toMatchObject({ remainingPercentage: 0, resetAt });
  });

  it("resolves the bare id through the -high tier's per-model quota", () => {
    const resetAt = new Date(Date.now() + 3600_000).toISOString();
    const quotas = { "gemini-4-hydrogen-high": { remainingPercentage: 0, resetAt } };
    expect(getAntigravityModelQuota(quotas, "gemini-4-hydrogen")).toMatchObject({ remainingPercentage: 0, resetAt });
    expect(getAntigravityModelQuota(quotas, "gemini-4-hydrogen(xhigh)")).toMatchObject({ remainingPercentage: 0 });
  });
});
