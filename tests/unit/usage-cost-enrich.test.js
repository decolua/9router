import { describe, it, expect } from "vitest";
import {
  enrichUsageCost,
  normalizeCostObject,
  filterUsageForFormat,
  extractUsage,
} from "../../open-sse/utils/usageTracking.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("normalizeCostObject", () => {
  it("wraps OpenRouter bare number as { total }", () => {
    expect(normalizeCostObject(9e-7)).toEqual({ total: 9e-7 });
  });

  it("passes through object with total", () => {
    expect(normalizeCostObject({ total: 0.0123, input: 0.01 })).toEqual({
      total: 0.0123,
      input: 0.01,
    });
  });

  it("returns null for garbage", () => {
    expect(normalizeCostObject(undefined)).toBeNull();
    expect(normalizeCostObject("x")).toBeNull();
  });
});

describe("filterUsageForFormat", () => {
  it("preserves cost for OpenAI format", () => {
    const out = filterUsageForFormat(
      {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
        cost: { total: 0.001 },
      },
      FORMATS.OPENAI
    );
    expect(out.cost).toEqual({ total: 0.001 });
    expect(out.prompt_tokens).toBe(10);
  });
});

describe("extractUsage", () => {
  it("keeps OpenRouter cost from a chat.completion chunk", () => {
    const u = extractUsage({
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        cost: 0.0042,
      },
    });
    expect(u.cost).toEqual({ total: 0.0042 });
  });
});

describe("enrichUsageCost", () => {
  it("prefers upstream OpenRouter cost over table estimate", () => {
    const out = enrichUsageCost(
      { prompt_tokens: 1000, completion_tokens: 100, cost: 0.0009 },
      "openrouter",
      "deepseek/deepseek-v4-flash-latest"
    );
    expect(out.cost.total).toBe(0.0009);
  });

  it("estimates from MODEL_PRICING when cost is missing", () => {
    const out = enrichUsageCost(
      { prompt_tokens: 1_000_000, completion_tokens: 0 },
      "openrouter",
      "z-ai/glm-5.3-flash"
    );
    // glm-5.3-flash input $0.15 / M
    expect(out.cost.total).toBeCloseTo(0.15, 6);
  });

  it("estimates deepseek-v4-flash-latest from table", () => {
    const out = enrichUsageCost(
      { prompt_tokens: 1_000_000, completion_tokens: 0 },
      "openrouter",
      "~deepseek/deepseek-v4-flash-latest"
    );
    expect(out.cost.total).toBeCloseTo(0.04, 6);
  });

  it("prices dated OpenRouter flash snapshots via pattern", () => {
    const out = enrichUsageCost(
      { prompt_tokens: 1_000_000, completion_tokens: 0 },
      "openrouter",
      "deepseek/deepseek-v4-flash-0731"
    );
    expect(out.cost.total).toBeCloseTo(0.04, 6);
  });
});
