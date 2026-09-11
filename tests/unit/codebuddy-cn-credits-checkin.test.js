import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCodeBuddyCredits } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const mockProxyAwareFetch = vi.fn();
vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => mockProxyAwareFetch(...args),
}));

// Import after mocking
import { dailyCheckinCodeBuddy } from "open-sse/services/usage/codebuddy-cn.js";

describe("CodeBuddy CN Credits & Checkin Helpers", () => {
  describe("getCodeBuddyCredits", () => {
    it("extracts totals from quota.raw.summary when available", () => {
      const quota = {
        raw: {
          summary: {
            totalCapacity: 5000,
            totalUsed: 1200,
            totalRemaining: 3800,
          },
        },
        quotas: [],
      };

      const credits = getCodeBuddyCredits(quota);
      expect(credits).toEqual({
        total: 5000,
        used: 1200,
        remaining: 3800,
      });
    });

    it("falls back to summing individual package quotas when summary is absent", () => {
      const quota = {
        quotas: [
          { name: "Monthly", total: 500, used: 100, remaining: 400 },
          { name: "Bonus Pack 1", total: 1000, used: 200 },
        ],
      };

      const credits = getCodeBuddyCredits(quota);
      expect(credits.total).toBe(1500);
      expect(credits.used).toBe(300);
      expect(credits.remaining).toBe(1200);
    });

    it("returns zeros gracefully for empty or invalid input", () => {
      expect(getCodeBuddyCredits(null)).toEqual({ total: 0, used: 0, remaining: 0 });
      expect(getCodeBuddyCredits({})).toEqual({ total: 0, used: 0, remaining: 0 });
    });
  });

  describe("dailyCheckinCodeBuddy", () => {
    beforeEach(() => {
      mockProxyAwareFetch.mockReset();
    });

    it("returns false if no credential is provided", async () => {
      const result = await dailyCheckinCodeBuddy(null, null);
      expect(result.ok).toBe(false);
      expect(result.message).toContain("not available");
    });

    it("handles successful checkin response (code 0)", async () => {
      mockProxyAwareFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ code: 0, msg: "success" })),
      });

      const result = await dailyCheckinCodeBuddy("test_token", null);
      expect(result.ok).toBe(true);
      expect(result.already).toBe(false);
      expect(result.code).toBe(0);
    });

    it("handles already checked in response (code 10001 or '已签到')", async () => {
      mockProxyAwareFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify({ code: 10001, msg: "今日已签到" })),
      });

      const result = await dailyCheckinCodeBuddy("test_token", null);
      expect(result.ok).toBe(true);
      expect(result.already).toBe(true);
      expect(result.code).toBe(10001);
    });
  });
});
