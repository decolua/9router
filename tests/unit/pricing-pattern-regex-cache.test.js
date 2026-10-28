import { describe, expect, it } from "vitest";

import { matchPattern, getPricingForModel, PATTERN_PRICING, MODEL_PRICING } from "../../open-sse/providers/pricing.js";

// #4622: matchPattern compiled a fresh RegExp per call. getPricingForModel
// walks all 51 PATTERN_PRICING entries per lookup, so that was ~51 RegExp
// compilations per resolution — 1.48 us/call vs 0.05 us/call cached.
//
// Caching a compiled regex is only safe if the compiled form is IDENTICAL to
// what the uncached path produced. These tests pin that, since a cache that
// returns the wrong regex would silently mis-price a model.

describe("cached matchPattern behaves identically (#4622)", () => {
  it("matches literal ids exactly", () => {
    expect(matchPattern("gpt-4o", "gpt-4o")).toBe(true);
    expect(matchPattern("gpt-4o", "gpt-4o-mini")).toBe(false);
    expect(matchPattern("gpt-4o", "GPT-4O")).toBe(true);   // case-insensitive
  });

  it("anchors at both ends", () => {
    expect(matchPattern("gpt-4", "gpt-4o")).toBe(false);
    expect(matchPattern("4o", "gpt-4o")).toBe(false);
  });

  it("treats * as a wildcard spanning anything", () => {
    expect(matchPattern("*codex*", "gpt-5.6-codex-high")).toBe(true);
    expect(matchPattern("*-codex-high", "gpt-5.6-codex-high")).toBe(true);
    expect(matchPattern("codex-*", "codex-mini")).toBe(true);
  });

  it("escapes regex metacharacters in the literal parts", () => {
    // Unescaped, "gpt-4.1" would match "gpt-441" too.
    expect(matchPattern("gpt-4.1", "gpt-4.1")).toBe(true);
    expect(matchPattern("gpt-4.1", "gpt-441")).toBe(false);
    expect(matchPattern("a+b", "a+b")).toBe(true);
    expect(matchPattern("a+b", "aab")).toBe(false);
    expect(matchPattern("v1.2(x)", "v1.2(x)")).toBe(true);
  });

  it("returns identical results for every real pattern x model pairing", () => {
    // Rebuild the uncached matcher and compare across the whole table, which is
    // the same check the issue reporter ran.
    const uncached = (pattern, model) =>
      new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i").test(model);

    const models = [
      "gpt-4o", "gpt-4o-mini", "claude-opus-5.5", "claude-sonnet-5",
      "gemini-4-argon", "glm-5.3-flash", "deepseek-v4-flash", "qwen3.5-397b-a17b",
      "muse-spark-1.3-contributor-free", "nvidia/nemotron-3-super-120b-a12b",
      ...Object.keys(MODEL_PRICING).slice(0, 60),
    ];
    let checked = 0;
    for (const { pattern } of PATTERN_PRICING) {
      for (const m of models) {
        expect(matchPattern(pattern, m), `${pattern} vs ${m}`).toBe(uncached(pattern, m));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("caches: repeated calls do not grow the cache", () => {
    // Warm it first — the first call for a pattern legitimately adds an entry.
    matchPattern("*warmup-pattern*", "x");
    const before = matchPattern._cache?.size ?? 0;
    for (let i = 0; i < 50; i++) matchPattern("*qwen3.5*", "qwen3.5-397b-a17b");
    expect(matchPattern._cache.size).toBe(before + 1);   // one new pattern, then stable
    const after = matchPattern._cache.size;
    for (let i = 0; i < 50; i++) matchPattern("*qwen3.5*", "qwen3.5-397b-a17b");
    expect(matchPattern._cache.size).toBe(after);
  });

  it("keys the cache by pattern, so different patterns do not collide", () => {
    matchPattern("*codex*", "codex-mini");
    matchPattern("*qwen*", "qwen3-max");
    const keys = [...(matchPattern._cache?.keys() || [])];
    expect(keys).toContain("*codex*");
    expect(keys).toContain("*qwen*");
  });
});

describe("pricing resolution is unaffected", () => {
  it("still resolves an exact model id", () => {
    expect(getPricingForModel("openai", "gpt-4o")).toBeTruthy();
  });

  it("still resolves via a pattern, repeatedly and consistently", () => {
    const a = getPricingForModel("anthropic", "claude-opus-5.5");
    const b = getPricingForModel("anthropic", "claude-opus-5.5");
    const c = getPricingForModel("anthropic", "claude-opus-5.5");
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("a later call cannot be poisoned by an earlier one", () => {
    // Two different models whose names overlap a pattern: each must get its own
    // answer even after the other has been resolved.
    const first = getPricingForModel("openai", "gpt-4o");
    getPricingForModel("openai", "gpt-4o-mini");
    const second = getPricingForModel("openai", "gpt-4o");
    expect(second).toEqual(first);
  });

  it("returns null for an unknown model rather than throwing", () => {
    expect(getPricingForModel("openai", "definitely-not-a-real-model-xyz")).toBeNull();
  });
});
