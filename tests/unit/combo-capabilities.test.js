import { describe, it, expect } from "vitest";

import {
  aggregateCapabilities,
  getComboCapabilities,
  getCapabilitiesForModel,
  DEFAULT_CAPABILITIES,
} from "../../open-sse/providers/capabilities.js";

describe("combo capabilities aggregation", () => {
  it("vision=false when any model lacks vision", () => {
    const caps = aggregateCapabilities([
      { ...DEFAULT_CAPABILITIES, vision: true, contextWindow: 200000 },
      { ...DEFAULT_CAPABILITIES, vision: false, contextWindow: 128000 },
    ]);
    expect(caps.vision).toBe(false);
  });

  it("vision=true only when ALL models have vision", () => {
    const caps = aggregateCapabilities([
      { ...DEFAULT_CAPABILITIES, vision: true, contextWindow: 200000 },
      { ...DEFAULT_CAPABILITIES, vision: true, contextWindow: 128000 },
    ]);
    expect(caps.vision).toBe(true);
  });

  it("contextWindow=MIN of all models", () => {
    const caps = aggregateCapabilities([
      { ...DEFAULT_CAPABILITIES, contextWindow: 200000 },
      { ...DEFAULT_CAPABILITIES, contextWindow: 128000 },
      { ...DEFAULT_CAPABILITIES, contextWindow: 1000000 },
    ]);
    expect(caps.contextWindow).toBe(128000);
  });

  it("maxOutput=MIN of all models", () => {
    const caps = aggregateCapabilities([
      { ...DEFAULT_CAPABILITIES, maxOutput: 64000 },
      { ...DEFAULT_CAPABILITIES, maxOutput: 8192 },
    ]);
    expect(caps.maxOutput).toBe(8192);
  });

  it("single-element input collapses to that model", () => {
    const caps = aggregateCapabilities([
      { ...DEFAULT_CAPABILITIES, vision: true, contextWindow: 500000, maxOutput: 10000 },
    ]);
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(500000);
    expect(caps.maxOutput).toBe(10000);
  });

  it("empty / non-array input returns DEFAULT", () => {
    expect(aggregateCapabilities([])).toEqual({ ...DEFAULT_CAPABILITIES });
    expect(aggregateCapabilities(null)).toEqual({ ...DEFAULT_CAPABILITIES });
    expect(aggregateCapabilities(undefined)).toEqual({ ...DEFAULT_CAPABILITIES });
  });

  it("numeric: skips non-finite values, still picks MIN of the rest", () => {
    const caps = aggregateCapabilities([
      { ...DEFAULT_CAPABILITIES, contextWindow: 200000, maxOutput: 64000 },
      { ...DEFAULT_CAPABILITIES, contextWindow: Infinity, maxOutput: 8192 },
      { ...DEFAULT_CAPABILITIES, contextWindow: 128000, maxOutput: undefined },
    ]);
    expect(caps.contextWindow).toBe(128000);
    expect(caps.maxOutput).toBe(8192);
  });

  it("thinkingFormat kept when unanimous, null when divergent", () => {
    const same = aggregateCapabilities([
      { ...DEFAULT_CAPABILITIES, thinkingFormat: "claude-adaptive" },
      { ...DEFAULT_CAPABILITIES, thinkingFormat: "claude-adaptive" },
    ]);
    expect(same.thinkingFormat).toBe("claude-adaptive");

    const diff = aggregateCapabilities([
      { ...DEFAULT_CAPABILITIES, thinkingFormat: "claude-adaptive" },
      { ...DEFAULT_CAPABILITIES, thinkingFormat: "openai" },
    ]);
    expect(diff.thinkingFormat).toBeNull();

    const partial = aggregateCapabilities([
      { ...DEFAULT_CAPABILITIES, thinkingFormat: "claude-adaptive" },
      { ...DEFAULT_CAPABILITIES, thinkingFormat: null },
    ]);
    expect(partial.thinkingFormat).toBeNull();
  });

  it("thinkingRange conservative bounds: max-of-mins, min-of-maxes", () => {
    const caps = aggregateCapabilities([
      { ...DEFAULT_CAPABILITIES, thinkingRange: { min: 0, max: 32000 } },
      { ...DEFAULT_CAPABILITIES, thinkingRange: { min: 100, max: 64000 } },
      { ...DEFAULT_CAPABILITIES, thinkingRange: { min: 50, max: 16000 } },
    ]);
    expect(caps.thinkingRange).toEqual({ min: 100, max: 16000 });
  });

  it("thinkingRange dropped when any model is missing it", () => {
    const caps = aggregateCapabilities([
      { ...DEFAULT_CAPABILITIES, thinkingRange: { min: 0, max: 32000 } },
      { ...DEFAULT_CAPABILITIES, thinkingRange: null },
    ]);
    expect(caps.thinkingRange).toBeNull();
  });
});

describe("getComboCapabilities", () => {
  it("aggregates over provider/model strings", () => {
    const caps = getComboCapabilities([
      "openai/gpt-4o",                    // vision:true, ctx 128000
      "anthropic/claude-sonnet-4-6",      // vision:true, ctx 1000000
    ]);
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(128000); // MIN
  });

  it("accepts slashless model strings (no provider prefix)", () => {
    const caps = getComboCapabilities(["gpt-5", "claude-sonnet-4-6"]);
    // gpt-5 = vision:true, ctx 400000; claude-sonnet-4-6 = vision:true, ctx 1000000
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(400000);
  });

  it("returns DEFAULT for empty / non-array input", () => {
    expect(getComboCapabilities([])).toEqual({ ...DEFAULT_CAPABILITIES });
    expect(getComboCapabilities(null)).toEqual({ ...DEFAULT_CAPABILITIES });
  });

  it("filters out non-string and whitespace entries", () => {
    const caps = getComboCapabilities([
      "",
      "   ",
      null,
      undefined,
      42,
      "openai/gpt-5",
    ]);
    // Only the last one resolves; result collapses to gpt-5 caps.
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(400000);
  });

  it("uses real getCapabilitiesForModel (not a re-implementation)", () => {
    // Sanity: a known static model matches what the registry returns.
    const direct = getCapabilitiesForModel("openai", "gpt-5");
    const combo = getComboCapabilities(["openai/gpt-5"]);
    expect(combo).toEqual(direct);
  });
});
