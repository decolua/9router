// End-to-end: a cache-bearing request flows through canonicalizeUsage →
// saveRequestUsage → getUsageStats, proving cached tokens are persisted,
// aggregated, and cost is computed correctly (the bug this branch fixes).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cached-e2e-"));
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

describe("cached-token end-to-end (persist + aggregate + cost)", () => {
  it("Claude cache usage: canonical prompt is inclusive, cached persisted, cost correct", async () => {
    // Raw Claude usage (cache-EXCLUSIVE prompt): input 100, cache_read 200, cache_creation 30, output 50
    const canonical = canonicalizeUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 30,
    });
    expect(canonical.prompt_tokens).toBe(330); // inclusive

    await db.saveRequestUsage({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      connectionId: "c-cache",
      tokens: canonical,
      endpoint: "/v1/messages",
      status: "ok",
    });

    const stats = await db.getUsageStats("24h");
    expect(stats.totalCachedTokens).toBe(200);
    expect(stats.totalPromptTokens).toBe(330);
    expect(stats.byProvider.anthropic.cachedTokens).toBe(200);

    // Cost: nonCached=330-200-30=100 @3 + cached 200 @0.30 + creation 30 @3.75 + output 50 @15
    const expected = (100 * 3 + 200 * 0.3 + 30 * 3.75 + 50 * 15) / 1_000_000;
    const hist = await db.getUsageHistory({ provider: "anthropic" });
    expect(hist.length).toBe(1);
    expect(hist[0].cost).toBeCloseTo(expected, 12);
    expect(hist[0].tokens.cached_tokens).toBe(200);
    expect(hist[0].tokens.cache_creation_input_tokens).toBe(30);
  });

  it("OpenAI cache usage: inclusive prompt passes through, cached counted once", async () => {
    const canonical = canonicalizeUsage({
      prompt_tokens: 1000,        // already includes cached
      completion_tokens: 200,
      cached_tokens: 600,
    });
    expect(canonical.prompt_tokens).toBe(1000);
    expect(canonical.cached_tokens).toBe(600);

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      connectionId: "c-oai",
      tokens: canonical,
      endpoint: "/v1/chat/completions",
      status: "ok",
    });

    const hist = await db.getUsageHistory({ provider: "openai" });
    expect(hist[0].tokens.prompt_tokens).toBe(1000);
    expect(hist[0].tokens.cached_tokens).toBe(600);
  });

  it("keeps API-key identity distinct and non-secret across every stats period", async () => {
    const keyA = await db.createApiKey("Shared name", "identity-machine");
    const keyB = await db.createApiKey("Shared name", "identity-machine");
    const deletedKey = await db.createApiKey("Deleted name", "identity-machine");
    const keys = [keyA, keyB, deletedKey];

    for (const [index, apiKey] of keys.entries()) {
      await db.saveRequestUsage({
        timestamp: new Date(Date.now() - index * 1000).toISOString(),
        provider: "identity-test",
        model: "same-model",
        apiKey: apiKey.key,
        tokens: { prompt_tokens: 10 + index, completion_tokens: 1 },
        endpoint: "/v1/responses",
        status: "ok",
      });
    }
    await db.deleteApiKey(deletedKey.id);

    for (const period of ["today", "24h", "7d", "30d", "60d", "all"]) {
      const stats = await db.getUsageStats(period);
      const serialized = JSON.stringify(stats.byApiKey);
      const rows = Object.entries(stats.byApiKey)
        .filter(([, row]) => row.provider === "identity-test" && row.rawModel === "same-model");

      expect(rows, period).toHaveLength(3);
      expect(new Set(rows.map(([key]) => key)).size, period).toBe(3);
      expect(new Set(rows.map(([, row]) => row.apiKeyKey)).size, period).toBe(3);
      expect(new Set(rows.map(([, row]) => row.keyName)).size, period).toBe(3);
      expect(rows.map(([, row]) => row.requests), period).toEqual([1, 1, 1]);
      for (const apiKey of keys) expect(serialized, period).not.toContain(apiKey.key);

      expect(rows.some(([, row]) => row.apiKeyKey === `api-key:${keyA.id}`), period).toBe(true);
      expect(rows.some(([, row]) => row.apiKeyKey === `api-key:${keyB.id}`), period).toBe(true);
      expect(rows.some(([, row]) => /^api-key:sha256:[0-9a-f]{64}$/.test(row.apiKeyKey)), period).toBe(true);
      for (const [key, row] of rows) {
        expect(key, period).toBe(`${row.apiKeyKey}|same-model|identity-test`);
        expect(row.keyName, period).toMatch(/ \([0-9a-f-]{8}\)$/);
      }
    }
  });
});
