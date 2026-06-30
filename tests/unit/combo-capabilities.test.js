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
