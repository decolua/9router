import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getAlibabaTokenPlanUsage,
  calcSlidingWindowUsage,
  getAlibabaPlanLimits,
  estimateAlibabaCredits,
  alibabaWindowMeta,
  alibabaUntracked7d,
  parseAlibabaResetAt,
  alibabaQuotaExhaustion,
  applyAlibabaQuotaExhaustion,
} from "open-sse/services/usage/alibabaTokenPlan.js";
import { getAdapter } from "@/lib/db/driver.js";

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: vi.fn(),
}));

describe("Alibaba Token Plan Local Usage Meter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getAlibabaPlanLimits", () => {
    it("returns Lite tier limits by default or for unknown plans", () => {
      expect(getAlibabaPlanLimits()).toEqual({ name: "Lite", limit7d: 2500 });
      expect(getAlibabaPlanLimits({ plan: "unknown" })).toEqual({ name: "Lite", limit7d: 2500 });
    });

    it("returns Standard tier limits for standard plan", () => {
      expect(getAlibabaPlanLimits({ plan: "Standard" })).toEqual({
        name: "Standard",
        limit7d: 10000,
      });
    });

    it("returns Pro tier limits for pro plan", () => {
      expect(getAlibabaPlanLimits({ plan: "Pro" })).toEqual({
        name: "Pro",
        limit7d: 40000,
      });
    });
  });

  describe("estimateAlibabaCredits", () => {
    it("calculates estimated credits correctly from prompt and completion tokens", () => {
      // 1,000,000 prompt tokens (uncached) + 100,000 completion tokens
      // USD = 1e6 * 2e-6 + 1e5 * 6e-6 = 2.0 + 0.6 = 2.6
      // credits = 2.6 / 0.002 = 1300
      const record = { promptTokens: 1000000, completionTokens: 100000 };
      expect(estimateAlibabaCredits(record)).toBe(1300);
    });

    it("handles cached tokens correctly from JSON string or object", () => {
      // 1,000,000 total prompt tokens, 800,000 cached => 200,000 uncached
      // uncached USD = 2e5 * 2e-6 = 0.4
      // cached USD = 8e5 * 0.25e-6 = 0.2
      // completion USD = 1e5 * 6e-6 = 0.6
      // Total USD = 1.2 => credits = 1.2 / 0.002 = 600
      const record = {
        tokens: JSON.stringify({
          prompt_tokens: 1000000,
          completion_tokens: 100000,
          cached_tokens: 800000,
        }),
      };
      expect(estimateAlibabaCredits(record)).toBe(600);
    });
  });

  describe("alibabaWindowMeta (Anchored Sliding Window)", () => {
    it("anchors window start to the first item timestamp and aggregates until end", () => {
      const now = 10000000;
      const windowMs = 5 * 3600 * 1000; // 5 hours = 18,000,000 ms
      const records = [
        { timestamp: now - 1000000, promptTokens: 1000000, completionTokens: 0 },
        { timestamp: now - 500000, promptTokens: 1000000, completionTokens: 0 },
      ];
      // Both records fall into window starting at (now - 1000000)
      const meta = alibabaWindowMeta(records, windowMs, now, true);
      expect(meta.start).toBe(now - 1000000);
      expect(meta.end).toBe(now - 1000000 + windowMs);
      expect(meta.used).toBe(2000); // 1000 credits each
    });

    it("creates a new anchor when an item exceeds previous window end", () => {
      const windowMs = 10000; // 10s
      const now = 25000; // Within Window 2 (20000 to 30000)
      const records = [
        { timestamp: 1000, promptTokens: 1000000, completionTokens: 0 }, // Window 1: 1000 to 11000
        { timestamp: 20000, promptTokens: 1000000, completionTokens: 0 }, // Window 2: 20000 to 30000
      ];
      const meta = alibabaWindowMeta(records, windowMs, now, true);
      // Last active window anchored at 20000
      expect(meta.start).toBe(20000);
      expect(meta.end).toBe(30000);
      expect(meta.used).toBe(1000);
    });
  });

  describe("alibabaUntracked7d", () => {
    it("includes untracked credits when window start matches hint within 2000ms", () => {
      const limits = {
        untrackedCredits7d: 500,
        untrackedCredits7dWindowStart: 10000,
      };
      expect(alibabaUntracked7d(limits, 10500)).toBe(500);
    });

    it("returns 0 when window start differs from hint by more than 2000ms", () => {
      const limits = {
        untrackedCredits7d: 500,
        untrackedCredits7dWindowStart: 10000,
      };
      expect(alibabaUntracked7d(limits, 15000)).toBe(0);
    });

    it("returns extra when no window start hint is provided", () => {
      const limits = { untrackedCredits7d: 500 };
      expect(alibabaUntracked7d(limits, 10000)).toBe(500);
    });
  });

  describe("calcSlidingWindowUsage (Exact Quota Names & Structure)", () => {
    it("produces correct credit quota structure and exact Portuguese names", () => {
      const now = Date.now();
      const records = [
        { timestamp: now - 1000, promptTokens: 1000000, completionTokens: 0 },
      ];
      const result = calcSlidingWindowUsage(records, now, { plan: "Lite", unit: "credits" });

      expect(result.plan).toBe("Alibaba Token Plan Lite (créditos estimados)");
      expect(result.status).toBe("ok");
      expect(result.source).toBe("router-local");
      expect(result.fetchedAt).toBe(new Date(now).toISOString());
      expect(result.quotas["Créditos 7d (estimado)"]).toBeDefined();
      expect(result.quotas["Créditos 7d (estimado)"].used).toBe(1000);
      expect(result.quotas["Créditos 7d (estimado)"].total).toBe(2500);
      expect(result.quotas["Créditos 7d (estimado)"].resetAt).toBe(
        new Date(now - 1000 + 7 * 86400 * 1000).toISOString()
      );
      expect(result.quotas["Créditos 5h (estimado)"]).toBeUndefined();
    });

    it("produces raw token quota names when unit is not credits", () => {
      const now = Date.now();
      const records = [
        { timestamp: now - 1000, promptTokens: 500, completionTokens: 500 },
      ];
      const result = calcSlidingWindowUsage(records, now, { unit: "tokens" });

      expect(result.plan).toBe("Alibaba Token Plan (medido pelo router)");
      expect(result.quotas["Consumo 7d (medido local)"]).toBeDefined();
      expect(result.quotas["Consumo 7d (medido local)"].used).toBe(1000);
      expect(result.quotas["Consumo 5h (medido local)"]).toBeUndefined();
    });
  });

  describe("getAlibabaTokenPlanUsage (Isolated DB queries)", () => {
    it("fetches usageHistory by connectionId when connectionId is provided", async () => {
      const now = Date.now();
      const mockAll = vi.fn().mockReturnValue([
        { promptTokens: 1000000, completionTokens: 0, timestamp: now - 5000 },
      ]);
      const mockDb = { all: mockAll, get: vi.fn() };
      getAdapter.mockResolvedValue(mockDb);

      const ctx = {
        connectionId: "conn-abc-123",
        providerSpecificData: { plan: "Standard" },
      };

      const result = await getAlibabaTokenPlanUsage(ctx, now);

      expect(getAdapter).toHaveBeenCalledTimes(1);
      expect(mockAll).toHaveBeenCalledWith(
        expect.stringContaining("WHERE connectionId = ? AND timestamp >= ?"),
        ["conn-abc-123", expect.any(String)]
      );
      // D13/REV-D: combo attempt-failure rows (status 'error:*') must never
      // anchor the sliding 7d window; removing the clause must fail here.
      expect(mockAll.mock.calls[0][0]).toContain("status NOT LIKE 'error%'");
      expect(result.plan).toBe("Alibaba Token Plan Standard (créditos estimados)");
      expect(result.quotas["Créditos 7d (estimado)"].used).toBe(1000);
    });

    it("resolves connectionId from apiKey via providerConnections when connectionId is missing", async () => {
      const now = Date.now();
      const mockGet = vi.fn().mockReturnValue({ id: "resolved-conn-456" });
      const mockAll = vi.fn().mockReturnValue([
        { promptTokens: 1000000, completionTokens: 0, timestamp: now - 2000 },
      ]);
      const mockDb = { get: mockGet, all: mockAll };
      getAdapter.mockResolvedValue(mockDb);

      const ctx = {
        apiKey: "sk-alitp-secret-key",
        providerSpecificData: { plan: "Pro" },
      };

      const result = await getAlibabaTokenPlanUsage(ctx, now);

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining("FROM providerConnections"),
        ["sk-alitp-secret-key"]
      );
      expect(mockAll).toHaveBeenCalledWith(
        expect.stringContaining("WHERE connectionId = ? AND timestamp >= ?"),
        ["resolved-conn-456", expect.any(String)]
      );
      expect(result.plan).toBe("Alibaba Token Plan Pro (créditos estimados)");
    });

    it("reads lastError from the connection row, not the narrowed dispatcher ctx", async () => {
      const now = Date.parse("2026-09-12T13:26:00Z");
      const row = {
        data: JSON.stringify({
          lastError:
            '[429]: {"error":{"message":"Your token-plan 1-week quota has been exhausted. The quota will reset at 09-18 16:04:00 UTC."}}',
          lastErrorAt: "2026-09-12T13:22:00Z",
        }),
      };
      const mockGet = vi.fn().mockReturnValue(row);
      getAdapter.mockResolvedValue({
        get: mockGet,
        all: vi.fn().mockReturnValue([
          { promptTokens: 1000000, completionTokens: 0, timestamp: now - 7200000 },
        ]),
      });

      // getUsageForProvider builds this ctx: connectionId only, no error fields.
      const result = await getAlibabaTokenPlanUsage(
        { connectionId: "conn-alitp", providerSpecificData: { plan: "Lite" } },
        now,
      );

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining("SELECT data FROM providerConnections WHERE id = ?"),
        ["conn-alitp"],
      );
      expect(result.quotas["Créditos 7d (estimado)"].used).toBe(2500);
      expect(result.quotas["Créditos 7d (estimado)"].resetAt).toBe("2026-09-18T16:04:00.000Z");
    });

    it("handles DB errors gracefully and returns valid result with zero usage", async () => {
      getAdapter.mockRejectedValue(new Error("Database disk I/O error"));

      const ctx = { connectionId: "conn-err" };
      const result = await getAlibabaTokenPlanUsage(ctx);

      expect(result.status).toBe("ok");
      expect(result.source).toBe("router-local");
      expect(result.quotas["Créditos 7d (estimado)"].used).toBe(0);
    });
  });

  describe("vendor 429 exhaustion (authoritative over the local estimate)", () => {
    const EXHAUSTED =
      '[429]: {"error":{"message":"Your token-plan 1-week quota has been exhausted. The quota will reset at 09-18 16:04:00 UTC.","type":"insufficient_quota"}}';

    it("parses the reset instant the vendor prints without a year", () => {
      const now = Date.parse("2026-09-12T13:26:00Z");
      expect(parseAlibabaResetAt(EXHAUSTED, now)).toBe("2026-09-18T16:04:00.000Z");
    });

    it("rolls the reset to the next year when the printed date is behind us", () => {
      const now = Date.parse("2026-12-30T00:00:00Z");
      expect(parseAlibabaResetAt(EXHAUSTED, now)).toBe("2027-09-18T16:04:00.000Z");
    });

    it("ignores errors that are not a quota exhaustion, or are stale", () => {
      const now = Date.parse("2026-09-12T13:26:00Z");
      expect(alibabaQuotaExhaustion("[500]: upstream exploded", now, now)).toBeNull();
      expect(alibabaQuotaExhaustion(EXHAUSTED, "2026-09-01T00:00:00Z", now)).toBeNull();
      expect(alibabaQuotaExhaustion(EXHAUSTED, "2026-09-12T13:22:00Z", now)).toEqual({
        at: Date.parse("2026-09-12T13:22:00Z"),
        resetAt: "2026-09-18T16:04:00.000Z",
      });
    });

    it("fills the weekly quota to the ceiling with the vendor resetAt", () => {
      const now = Date.parse("2026-09-12T13:26:00Z");
      const result = calcSlidingWindowUsage([], now, { plan: "Lite", unit: "credits" });
      applyAlibabaQuotaExhaustion(
        result,
        { lastError: EXHAUSTED, lastErrorAt: "2026-09-12T13:22:00Z" },
        [],
        now,
      );

      const quota = result.quotas["Créditos 7d (estimado)"];
      expect(quota.used).toBe(2500);
      expect(quota.total).toBe(2500);
      expect(quota.remainingPercentage).toBe(0);
      expect(quota.resetAt).toBe("2026-09-18T16:04:00.000Z");
    });

    it("stops reporting exhaustion once a call succeeds after the 429", () => {
      const now = Date.parse("2026-09-12T13:26:00Z");
      const result = calcSlidingWindowUsage(
        [{ timestamp: now - 1000, promptTokens: 1000000, completionTokens: 0 }],
        now,
        { unit: "credits" },
      );
      applyAlibabaQuotaExhaustion(
        result,
        { lastError: EXHAUSTED, lastErrorAt: "2026-09-12T13:00:00Z" },
        [{ timestamp: now - 1000, promptTokens: 1000000, completionTokens: 0 }],
        now,
      );

      expect(result.quotas["Créditos 7d (estimado)"].used).toBe(1000);
    });

    it("surfaces the vendor state through getAlibabaTokenPlanUsage", async () => {
      const now = Date.parse("2026-09-12T13:26:00Z");
      getAdapter.mockResolvedValue({
        all: vi.fn().mockReturnValue([
          { promptTokens: 1000000, completionTokens: 0, timestamp: now - 7200000 },
        ]),
        get: vi.fn(),
      });

      const result = await getAlibabaTokenPlanUsage(
        {
          connectionId: "conn-alitp",
          providerSpecificData: { plan: "Lite" },
          lastError: EXHAUSTED,
          lastErrorAt: "2026-09-12T13:22:00Z",
        },
        now,
      );

      expect(result.quotas["Créditos 7d (estimado)"].remainingPercentage).toBe(0);
      expect(result.quotas["Créditos 7d (estimado)"].resetAt).toBe("2026-09-18T16:04:00.000Z");
    });
  });
});
