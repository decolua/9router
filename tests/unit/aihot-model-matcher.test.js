import { describe, it, expect } from "vitest";
import {
  buildLeaderboardIndex,
  classifyModel,
  partitionProviderModels,
  extractCandidateKeys,
  isObviousNonMatch,
} from "../../src/lib/aihot/modelMatcher.js";

const SAMPLE_CATALOG = [
  {
    slug: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    rawAliases: ["anthropic/claude-opus-5-5", "claude-opus-5-5-high", "claude-opus-5-5-max-effort"],
    categories: ["coding", "reasoning"],
  },
  {
    slug: "gpt-6-astra",
    name: "GPT-6 Astra",
    rawAliases: ["openai/gpt-6-astra", "gpt-6-astra-max"],
    categories: ["general", "knowledge"],
  },
  {
    slug: "gpt-5-6-terra",
    name: "GPT-5.6 Terra",
    rawAliases: ["openai/gpt-5.6-terra", "gpt-5-6-terra"],
    categories: ["coding"],
  },
  {
    slug: "gemini-4-argon",
    name: "Gemini 4 Argon",
    rawAliases: ["google/gemini-4-argon"],
    categories: ["reasoning"],
  },
  {
    slug: "deepseek-v-4-1-flash",
    name: "DeepSeek V4.1 Flash",
    rawAliases: ["deepseek-ai/DeepSeek-V4.1-Flash", "deepseek-v4-1-flash"],
    categories: ["coding"],
  },
  {
    slug: "qwen-3-8-max",
    name: "Qwen3.8 Max",
    rawAliases: ["qwen3-8-max", "qwen3.8-max-0803"],
    categories: ["coding"],
  },
  {
    slug: "glm-5-3",
    name: "GLM-5.3",
    rawAliases: ["zai/glm-5.3", "glm-5.3-bf16"],
    categories: ["general"],
  },
];

describe("aihot modelMatcher", () => {
  const index = buildLeaderboardIndex(SAMPLE_CATALOG);

  it("extracts candidate keys correctly from prefixed and un-prefixed models", () => {
    const res = extractCandidateKeys("pollinations/chigwell/gpt-5.6-terra");
    expect(res.clean).toBe("gpt-5.6-terra");
    expect(res.norm).toBe("gpt-5-6-terra");
    expect(res.base).toBe("gpt-5-6-terra");
  });

  it("identifies obvious obsolete models as non-matches", () => {
    expect(isObviousNonMatch("gpt-3.5-turbo")).toBe(true);
    expect(isObviousNonMatch("gpt-4o-mini")).toBe(true);
    expect(isObviousNonMatch("claude-3-5-sonnet-20241022")).toBe(true);
    expect(isObviousNonMatch("gemini-1.5-flash")).toBe(true);
    expect(isObviousNonMatch("llama-3.1-70b")).toBe(true);
    expect(isObviousNonMatch("qwen-2.5-72b")).toBe(true);
    expect(isObviousNonMatch("deepseek-v3")).toBe(true);
    expect(isObviousNonMatch("bge-large-zh-v1.5")).toBe(true);

    // Leaderboard models are NOT obvious non-matches
    expect(isObviousNonMatch("gpt-6-astra")).toBe(false);
    expect(isObviousNonMatch("claude-opus-5-5")).toBe(false);
    expect(isObviousNonMatch("qwen-3.8-max")).toBe(false);
  });

  it("classifies confirmed matches with high confidence as 'keep'", () => {
    // Exact slug
    const r1 = classifyModel("claude-opus-5-5", index);
    expect(r1.status).toBe("keep");
    expect(r1.matchedModel.slug).toBe("claude-opus-5-5");

    // With provider prefix and date/effort suffix
    const r2 = classifyModel("pollinations/chigwell/gpt-5.6-terra", index);
    expect(r2.status).toBe("keep");
    expect(r2.matchedModel.slug).toBe("gpt-5-6-terra");

    // DeepSeek V4.1
    const r3 = classifyModel("deepseek-ai/DeepSeek-V4.1-Flash", index);
    expect(r3.status).toBe("keep");
    expect(r3.matchedModel.slug).toBe("deepseek-v-4-1-flash");

    // Qwen3.8 Max with variants
    const r4 = classifyModel("qwen/qwen-3.8-max", index);
    expect(r4.status).toBe("keep");
    expect(r4.matchedModel.slug).toBe("qwen-3-8-max");
  });

  it("classifies obvious non-matches as 'reject'", () => {
    const r1 = classifyModel("openai/gpt-3.5-turbo", index);
    expect(r1.status).toBe("reject");

    const r2 = classifyModel("meta/llama-3.1-8b-instruct", index);
    expect(r2.status).toBe("reject");

    const r3 = classifyModel("google/gemini-1.5-pro", index);
    expect(r3.status).toBe("reject");
  });

  it("classifies ambiguous/uncertain models as 'uncertain' for human decision", () => {
    // Has similarity to qwen-3.8-max but unknown variant
    const r1 = classifyModel("qwen-3.8-hybrid-preview", index);
    expect(r1.status).toBe("uncertain");
    expect(r1.candidate).toBeDefined();

    // Has similarity to deepseek-v-4-1-flash but custom suffix
    const r2 = classifyModel("deepseek-v4-turbo-custom", index);
    expect(r2.status).toBe("uncertain");
  });

  it("respects user memory decisions for unverified models and allows leaderboard to resurrect models", () => {
    const memory = {
      "custom-model-x": { decision: "keep", updatedAt: "2026-10-14T00:00:00Z" },
      "custom-model-y": { decision: "reject", updatedAt: "2026-10-14T00:00:00Z" },
    };

    // Unknown model -> but user previously kept it -> keep
    const r1 = classifyModel("custom-model-x", index, memory);
    expect(r1.status).toBe("keep");
    expect(r1.reason).toBe("remembered_user_keep");

    // Unknown model -> user previously rejected it -> reject
    const r2 = classifyModel("custom-model-y", index, memory);
    expect(r2.status).toBe("reject");
    expect(r2.reason).toBe("remembered_user_reject");

    // Leaderboard model: fresh leaderboard appearance resurrects a previously rejected model
    const staleRejection = { "claude-opus-5-5": { decision: "reject" } };
    const r3 = classifyModel("claude-opus-5-5", index, staleRejection);
    expect(r3.status).toBe("keep");
    expect(r3.reason).toBe("exact_slug_match");
  });

  it("partitions a batch of models correctly", () => {
    const models = [
      { id: "anthropic/claude-opus-5-5" },
      { id: "openai/gpt-3.5-turbo" },
      { id: "unknown-qwen-3.8-special" },
    ];

    const result = partitionProviderModels(models, index);
    expect(result.keep).toHaveLength(1);
    expect(result.keep[0].id).toBe("anthropic/claude-opus-5-5");

    expect(result.reject).toHaveLength(1);
    expect(result.reject[0].id).toBe("openai/gpt-3.5-turbo");

    expect(result.uncertain).toHaveLength(1);
    expect(result.uncertain[0].id).toBe("unknown-qwen-3.8-special");
    expect(result.uncertain[0]._review).toBeDefined();
  });
});

describe("aihot modelMatcher - comprehensive cases", () => {
  const index = buildLeaderboardIndex(SAMPLE_CATALOG);

  it("handles complex vendor decorations and variations", () => {
    // gemini-4-argon with suffix
    expect(classifyModel("google/gemini-4-argon-preview", index).status).toBe("keep");
    // GLM 5.3 with bf16 tag
    expect(classifyModel("baseten/zai-org/GLM-5.3-BF16", index).status).toBe("keep");
    // Qwen 3.8 max with date
    expect(classifyModel("qwen/Qwen3.8-Max-0803", index).status).toBe("keep");
  });

  it("distinguishes obsolete version numbers from leaderboard versions", () => {
    // GPT-4 vs GPT-5.6 / GPT-6
    expect(classifyModel("gpt-4-0613", index).status).toBe("reject");
    expect(classifyModel("gpt-4o", index).status).toBe("reject");
    expect(classifyModel("gpt-5.6-terra", index).status).toBe("keep");
    expect(classifyModel("gpt-6-astra", index).status).toBe("keep");

    // Claude 3 vs Claude 5
    expect(classifyModel("claude-3-opus-20240229", index).status).toBe("reject");
    expect(classifyModel("claude-3-5-sonnet-latest", index).status).toBe("reject");
    expect(classifyModel("claude-opus-5-5", index).status).toBe("keep");
  });
});
