import { describe, expect, it } from "vitest";
import { aggregateComboCapabilities } from "../../open-sse/providers/capabilities.js";

describe("aggregateComboCapabilities — null / empty", () => {
  it("returns null for null", () => {
    expect(aggregateComboCapabilities(null)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(aggregateComboCapabilities([])).toBeNull();
  });
});

describe("aggregateComboCapabilities — single model passthrough", () => {
  it("single model returns its own capabilities", () => {
    const caps = aggregateComboCapabilities(["opencode-go/mimo-v2.5"]);
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("deepseek");
    expect(caps.thinkingCanDisable).toBe(false);
    expect(caps.contextWindow).toBe(1048576);
    expect(caps.maxOutput).toBe(131072);
  });
});

describe("aggregateComboCapabilities — union fields (vision, audioInput, search)", () => {
  it("vision is true if any backend has it", () => {
    // deepseek-v4-pro: no vision; mimo-v2.5: vision
    const caps = aggregateComboCapabilities([
      "opencode-go/deepseek-v4-pro",
      "opencode-go/mimo-v2.5",
    ]);
    expect(caps.vision).toBe(true);
  });

  it("vision is false if no backend has it", () => {
    const caps = aggregateComboCapabilities([
      "opencode-go/deepseek-v4-pro",
      "opencode-go/deepseek-v4-flash",
    ]);
    expect(caps.vision).toBe(false);
  });

  it("audioInput is true if any backend has it", () => {
    // mimo-omni has audioInput; mimo-v2.5 does not
    const caps = aggregateComboCapabilities([
      "opencode-go/mimo-v2.5",
      "opencode-go/mimo-omni-test",
    ]);
    expect(caps.audioInput).toBe(true);
  });

  it("search is true if any backend has it", () => {
    // gpt-5: search; mimo-v2.5: no search
    const caps = aggregateComboCapabilities([
      "openai/gpt-5",
      "opencode-go/mimo-v2.5",
    ]);
    expect(caps.search).toBe(true);
  });
});

describe("aggregateComboCapabilities — intersection: tools", () => {
  it("tools is false if any backend lacks it", () => {
    // gpt-image-1: tools:false; gpt-5: tools:true
    const caps = aggregateComboCapabilities([
      "openai/gpt-5",
      "openai/gpt-image-1",
    ]);
    expect(caps.tools).toBe(false);
  });

  it("tools is true when all backends support it", () => {
    const caps = aggregateComboCapabilities([
      "opencode-go/mimo-v2.5",
      "opencode-go/kimi-k2.5",
    ]);
    expect(caps.tools).toBe(true);
  });
});

describe("aggregateComboCapabilities — primary model drives reasoning fields", () => {
  it("thinkingFormat comes from the first model", () => {
    // primary: mimo-v2.5 (deepseek); secondary: kimi-k2.5 (kimi)
    const caps = aggregateComboCapabilities([
      "opencode-go/mimo-v2.5",
      "opencode-go/kimi-k2.5",
    ]);
    expect(caps.thinkingFormat).toBe("deepseek");
    expect(caps.reasoning).toBe(true);
  });

  it("flipping order changes thinkingFormat to the new primary", () => {
    const caps = aggregateComboCapabilities([
      "opencode-go/kimi-k2.5",
      "opencode-go/mimo-v2.5",
    ]);
    expect(caps.thinkingFormat).toBe("kimi");
  });
});

describe("aggregateComboCapabilities — context/output limits", () => {
  it("contextWindow is the minimum across all models", () => {
    // mimo-v2.5: 1048576; kimi-k2.5 (*kimi*k2* pattern): 262144
    const caps = aggregateComboCapabilities([
      "opencode-go/mimo-v2.5",
      "opencode-go/kimi-k2.5",
    ]);
    expect(caps.contextWindow).toBe(262144);
  });

  it("maxOutput is the maximum across all models", () => {
    // mimo-v2.5: 131072; kimi-k2.5 (*kimi*k2* pattern): 262144
    const caps = aggregateComboCapabilities([
      "opencode-go/mimo-v2.5",
      "opencode-go/kimi-k2.5",
    ]);
    expect(caps.maxOutput).toBe(262144);
  });
});

describe("aggregateComboCapabilities — nested combo resolution via comboLookup", () => {
  it("resolves nested combo and unions vision from its members", () => {
    const lookup = { "inner-combo": ["opencode-go/deepseek-v4-pro", "opencode-go/mimo-v2.5"] };
    const caps = aggregateComboCapabilities(["inner-combo"], lookup);
    expect(caps.reasoning).toBe(true);
    expect(caps.vision).toBe(true); // mimo brings vision through the lookup
  });

  it("outer combo gets vision via nested combo containing mimo", () => {
    const lookup = { "deepseek-v4-pro-fusion": ["opencode-go/deepseek-v4-pro", "opencode-go/mimo-v2.5"] };
    const caps = aggregateComboCapabilities(["deepseek-v4-pro-fusion", "openai/gpt-5"], lookup);
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
  });

  it("contextWindow is min across all resolved leaves", () => {
    // deepseek-v4-pro (*deepseek-v4*): 1000000; mimo-v2.5: 1048576 → min = 1000000
    const lookup = { "inner": ["opencode-go/deepseek-v4-pro"] };
    const caps = aggregateComboCapabilities(["inner", "opencode-go/mimo-v2.5"], lookup);
    expect(caps.contextWindow).toBe(1000000);
  });

  it("handles cycles without throwing", () => {
    const lookup = { "a": ["b"], "b": ["a"] };
    expect(() => aggregateComboCapabilities(["a"], lookup)).not.toThrow();
  });

  it("without comboLookup bare combo name falls through to pattern match", () => {
    // *deepseek-v4* pattern: reasoning true, vision false
    const caps = aggregateComboCapabilities(["deepseek-v4-pro-fusion"]);
    expect(caps.reasoning).toBe(true);
    expect(caps.vision).toBe(false);
  });
});
