// Regression for #4191: per-API-key usage was cross-attributed (all keys on an
// instance masked to the same 8-char prefix and collided into one bucket), and
// the cost breakdown was a blended token-share instead of per-component rates.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { calculateCostBreakdown, calculateCostFromTokens } from "../../open-sse/providers/pricing.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

// Same instance → same machineId → identical key prefixes.
const MACHINE_ID = "6581be4f05a82b6b";
const KEY_A = `sk-${MACHINE_ID}-aaaaaa-11111111`;
const KEY_B = `sk-${MACHINE_ID}-bbbbbb-22222222`;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-attribution-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("per-API-key attribution", () => {
  it("keeps two keys on the same machineId in separate buckets", async () => {
    const base = {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      endpoint: "/v1/messages",
      status: "ok",
    };

    // KEY_A first, so a collision would label the merged bucket with A's name.
    await db.saveRequestUsage({
      ...base, apiKey: KEY_A,
      tokens: { prompt_tokens: 1000, completion_tokens: 100 },
    });
    for (let i = 0; i < 3; i++) {
      await db.saveRequestUsage({
        ...base, apiKey: KEY_B,
        timestamp: new Date(Date.now() + (i + 1) * 1000).toISOString(),
        tokens: { prompt_tokens: 2000, completion_tokens: 200 },
      });
    }

    const stats = await db.getUsageStats("24h");
    const buckets = Object.values(stats.byApiKey);
    expect(buckets.length).toBe(2);

    const masks = buckets.map((b) => b.apiKeyMasked);
    expect(new Set(masks).size).toBe(2);
    for (const m of masks) {
      expect(m).not.toContain(MACHINE_ID);
    }

    const byRequests = [...buckets].sort((a, b) => a.requests - b.requests);
    expect(byRequests[0].requests).toBe(1);
    expect(byRequests[0].promptTokens).toBe(1000);
    expect(byRequests[1].requests).toBe(3);
    expect(byRequests[1].promptTokens).toBe(6000);
  });
});

describe("cost breakdown uses per-component rates", () => {
  const pricing = { input: 3, cached: 0.3, cache_creation: 3.75, output: 15 };

  it("splits components at their own rates and sums to the total", () => {
    const tokens = {
      prompt_tokens: 330,
      completion_tokens: 50,
      cached_tokens: 200,
      cache_creation_input_tokens: 30,
    };
    const bd = calculateCostBreakdown(tokens, pricing);

    expect(bd.inputCost).toBeCloseTo((100 * 3) / 1e6, 12);
    expect(bd.cachedCost).toBeCloseTo((200 * 0.3) / 1e6, 12);
    expect(bd.cacheWriteCost).toBeCloseTo((30 * 3.75) / 1e6, 12);
    expect(bd.outputCost).toBeCloseTo((50 * 15) / 1e6, 12);
    expect(bd.totalCost).toBeCloseTo(calculateCostFromTokens(tokens, pricing), 12);
  });

  it("keeps cached cheaper and output dearer per token than input", () => {
    // The old blended split made cached cost exceed input cost on cache-heavy
    // traffic while output collapsed to a rounding error.
    const bd = calculateCostBreakdown({
      prompt_tokens: 100000,
      completion_tokens: 1000,
      cached_tokens: 98000,
    }, pricing);

    const inputRate = bd.inputCost / 2000;
    expect(bd.cachedCost / 98000).toBeLessThan(inputRate);
    expect(bd.outputCost / 1000).toBeGreaterThan(inputRate);
  });

  it("bills reasoning tokens into the output bucket", () => {
    const bd = calculateCostBreakdown({
      prompt_tokens: 10, completion_tokens: 10, reasoning_tokens: 10,
    }, pricing);
    expect(bd.outputCost).toBeCloseTo((20 * 15) / 1e6, 12);
  });

  it("still reports a split for multi-day periods reading pre-fix daily rows", async () => {
    // 7d/30d read usageDaily, whose older rows carry only a total.
    const stats = await db.getUsageStats("7d");
    const buckets = Object.values(stats.byApiKey);
    expect(buckets.length).toBeGreaterThan(0);
    for (const b of buckets) {
      const sum = b.inputCost + b.cachedCost + b.cacheWriteCost + b.outputCost;
      expect(sum).toBeCloseTo(b.cost, 9);
    }
  });
});
