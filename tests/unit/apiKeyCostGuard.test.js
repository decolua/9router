import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkApiKeyDailyCost, secondsUntilLocalMidnight } from "../../src/lib/billing/apiKeyCostGuard.js";
import * as usageRepo from "../../src/lib/db/repos/usageRepo.js";
import { getSettings } from "../../src/lib/localDb.js";

describe("apiKeyCostGuard", () => {
  describe("secondsUntilLocalMidnight", () => {
    it("returns a value between 0 and 86400", () => {
      const result = secondsUntilLocalMidnight();
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(86400);
    });

    it("returns 1 second before midnight", () => {
      const now = new Date(2026, 0, 1, 23, 59, 59);
      const result = secondsUntilLocalMidnight(now);
      expect(result).toBe(1);
    });
  });

  describe("checkApiKeyDailyCost", () => {
    let spy;

    beforeEach(() => {
      spy = vi.spyOn(usageRepo, "getDailyKeyModelCost").mockResolvedValue(0);
    });

    afterEach(() => {
      spy.mockRestore();
    });

    it("allows when model is not in limits", async () => {
      const result = await checkApiKeyDailyCost({
        apiKey: "ak",
        model: "gpt-4",
        provider: "openai",
        settings: { apiKeyDailyCostLimits: { "claude-opus-4-8": 200 } },
      });
      expect(result).toEqual({ blocked: false, limit: 0, cost: 0 });
    });

    it("allows when cost is strictly under limit", async () => {
      spy.mockResolvedValue(199.99);
      const result = await checkApiKeyDailyCost({
        apiKey: "ak",
        model: "claude-opus-4-8",
        provider: "anthropic",
        settings: { apiKeyDailyCostLimits: { "claude-opus-4-8": 200 } },
      });
      expect(result).toEqual({ blocked: false, limit: 200, cost: 199.99 });
    });

    it("blocks when cost exactly equals limit", async () => {
      spy.mockResolvedValue(200);
      const result = await checkApiKeyDailyCost({
        apiKey: "ak",
        model: "claude-opus-4-8",
        provider: "anthropic",
        settings: { apiKeyDailyCostLimits: { "claude-opus-4-8": 200 } },
      });
      expect(result.blocked).toBe(true);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(86400);
    });

    it("blocks when cost exceeds limit", async () => {
      spy.mockResolvedValue(250);
      const result = await checkApiKeyDailyCost({
        apiKey: "ak",
        model: "claude-opus-4-8",
        provider: "anthropic",
        settings: { apiKeyDailyCostLimits: { "claude-opus-4-8": 200 } },
      });
      expect(result.blocked).toBe(true);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("allows when limit is zero or negative", async () => {
      const result = await checkApiKeyDailyCost({
        apiKey: "ak",
        model: "claude-opus-4-8",
        provider: "anthropic",
        settings: { apiKeyDailyCostLimits: { "claude-opus-4-8": 0 } },
      });
      expect(result).toEqual({ blocked: false, limit: 0, cost: 0 });
    });

    it("allows when settings missing apiKeyDailyCostLimits", async () => {
      const result = await checkApiKeyDailyCost({
        apiKey: "ak",
        model: "claude-opus-4-8",
        provider: "anthropic",
        settings: {},
      });
      expect(result).toEqual({ blocked: false, limit: 0, cost: 0 });
    });

    it("calls getDailyKeyModelCost with normalized apiKey, model, provider", async () => {
      await checkApiKeyDailyCost({
        apiKey: "ak",
        model: "claude-opus-4-8",
        provider: "anthropic",
        settings: { apiKeyDailyCostLimits: { "claude-opus-4-8": 200 } },
      });
      expect(spy).toHaveBeenCalledWith({ apiKey: "ak", model: "claude-opus-4-8", provider: "anthropic" });
    });
  });

  describe("settings default", () => {
    it("defaults claude-opus-4-8 limit to 200", async () => {
      const settings = await getSettings();
      expect(settings.apiKeyDailyCostLimits).toEqual({ "claude-opus-4-8": 200 });
    });
  });
});
