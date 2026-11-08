import { describe, it, expect, beforeEach } from "vitest";
import {
  buildLeaderboardIndex,
  partitionProviderModels,
} from "../../src/lib/aihot/modelMatcher.js";
import {
  clearFilterDecisions,
  setFilterDecision,
  getFilterDecisions,
} from "../../src/lib/db/repos/syncFilterDecisionsRepo.js";

const TEST_CATALOG = [
  {
    slug: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    rawAliases: ["anthropic/claude-opus-5-5"],
  },
  {
    slug: "gpt-6-astra",
    name: "GPT-6 Astra",
    rawAliases: ["openai/gpt-6-astra"],
  },
  {
    slug: "deepseek-v-4-1-flash",
    name: "DeepSeek V4.1 Flash",
    rawAliases: ["deepseek-ai/DeepSeek-V4.1-Flash"],
  },
  {
    slug: "qwen-3-8-max",
    name: "Qwen3.8 Max",
    rawAliases: ["qwen/qwen-3.8-max"],
  },
];

describe("sync-models leaderboard filtering pipeline", () => {
  beforeEach(async () => {
    await clearFilterDecisions();
  });

  it("filters a provider catalog into keep, reject, and uncertain lists", () => {
    const index = buildLeaderboardIndex(TEST_CATALOG);
    const providerCatalog = [
      // 1. Definite match
      { id: "claude-opus-5-5" },
      { id: "openai/gpt-6-astra" },

      // 2. Definite obsolete/low-end reject
      { id: "gpt-3.5-turbo" },
      { id: "claude-3-5-sonnet-20241022" },
      { id: "llama-3.1-8b" },
      { id: "qwen-2.5-7b" },
      { id: "deepseek-v3" },

      // 3. Uncertain/ambiguous variant
      { id: "qwen-3.8-experimental" },
      { id: "deepseek-v4-custom" },
    ];

    const result = partitionProviderModels(providerCatalog, index);

    expect(result.keep.map((m) => m.id)).toEqual(["claude-opus-5-5", "openai/gpt-6-astra"]);

    const rejectedIds = result.reject.map((m) => m.id);
    expect(rejectedIds).toContain("gpt-3.5-turbo");
    expect(rejectedIds).toContain("claude-3-5-sonnet-20241022");
    expect(rejectedIds).toContain("llama-3.1-8b");
    expect(rejectedIds).toContain("qwen-2.5-7b");
    expect(rejectedIds).toContain("deepseek-v3");

    const uncertainIds = result.uncertain.map((m) => m.id);
    expect(uncertainIds).toContain("qwen-3.8-experimental");
    expect(uncertainIds).toContain("deepseek-v4-custom");
  });

  it("applies remembered user decisions on subsequent sync passes", async () => {
    const index = buildLeaderboardIndex(TEST_CATALOG);

    // User decided to KEEP "qwen-3.8-experimental" and REJECT "deepseek-v4-custom"
    await setFilterDecision("qwen-3.8-experimental", "keep");
    await setFilterDecision("deepseek-v4-custom", "reject");

    const memory = await getFilterDecisions();

    const providerCatalog = [
      { id: "qwen-3.8-experimental" },
      { id: "deepseek-v4-custom" },
    ];

    const result = partitionProviderModels(providerCatalog, index, memory);

    // Now qwen-3.8-experimental is kept automatically!
    expect(result.keep.map((m) => m.id)).toContain("qwen-3.8-experimental");
    // And deepseek-v4-custom is rejected automatically!
    expect(result.reject.map((m) => m.id)).toContain("deepseek-v4-custom");
    // Uncertain list is empty!
    expect(result.uncertain).toHaveLength(0);
  });
});
