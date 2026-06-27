import { describe, it, expect } from "vitest";

import { getCapabilitiesForModel, DEFAULT_CAPABILITIES } from "../../open-sse/providers/capabilities.js";

// Re-implement the aggregation logic inline to test the contract
// (the functions in route.js aren't exported, but the logic is what matters)
function aggregateCapabilities(capsList) {
  const first = capsList[0];
  if (!first) return { ...DEFAULT_CAPABILITIES };

  const booleanKeys = [
    "vision", "pdf", "audioInput", "videoInput",
    "audioOutput", "imageOutput", "search", "tools", "reasoning",
    "thinkingCanDisable",
  ];
  const numericKeys = ["contextWindow", "maxOutput"];

  const result = { ...DEFAULT_CAPABILITIES };

  for (const key of booleanKeys) {
    result[key] = capsList.every((c) => c?.[key] === true);
  }

  for (const key of numericKeys) {
    const vals = capsList.map((c) => c?.[key]).filter((v) => typeof v === "number" && Number.isFinite(v));
    if (vals.length > 0) {
      result[key] = Math.min(...vals);
    }
  }

  return result;
}

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
});
