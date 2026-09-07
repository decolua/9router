import { describe, expect, it } from "vitest";
import {
  applyModelLimitsToCaps,
  modelLimitsForOpenAI,
  normalizeDiscoveredModel,
  normalizeModelLimits,
  validateModelLimits,
} from "../../src/shared/utils/modelTokenLimits.js";

describe("custom model token limits", () => {
  it("normalizes common direct and nested upstream fields", () => {
    expect(normalizeModelLimits({ context_length: 131072, max_output_tokens: "8192" })).toEqual({
      contextWindow: 131072,
      maxOutput: 8192,
    });
    expect(normalizeModelLimits({ limit: { context: 200000, output: 64000 } })).toEqual({
      contextWindow: 200000,
      maxOutput: 64000,
    });
    expect(normalizeModelLimits({ capabilities: { limits: { max_context_window_tokens: 300000, max_output_tokens: 12000 } } })).toEqual({
      contextWindow: 300000,
      maxOutput: 12000,
    });
  });

  it("keeps unknown limits absent and rejects invalid supplied values", () => {
    expect(normalizeModelLimits({ id: "unknown" })).toEqual({});
    expect(validateModelLimits({ contextWindow: 0, max_output_tokens: 2.5 })).toEqual({
      limits: {},
      errors: ["contextWindow must be a positive integer", "maxOutput must be a positive integer"],
    });
  });

  it("keeps discovery normalization lenient but manual validation strict", () => {
    expect(normalizeModelLimits({ context_length: "131072" })).toEqual({ contextWindow: 131072 });
    expect(validateModelLimits({ context_length: "131072" })).toEqual({
      limits: {},
      errors: ["contextWindow must be a positive integer"],
    });
  });

  it("adds discovered limits without replacing existing capabilities", () => {
    expect(normalizeDiscoveredModel({
      id: "model-a",
      capabilities: { tools: true },
      max_input_tokens: 100000,
      max_completion_tokens: 4096,
    })).toEqual({
      id: "model-a",
      capabilities: { tools: true },
      max_input_tokens: 100000,
      max_completion_tokens: 4096,
      caps: { contextWindow: 100000, maxOutput: 4096 },
    });
  });

  it("lets explicit limits override fallback without inventing a missing limit", () => {
    expect(applyModelLimitsToCaps({ contextWindow: 200000, maxOutput: 64000 }, { max_output_tokens: 8192 })).toEqual({
      contextWindow: 200000,
      maxOutput: 8192,
    });
    expect(applyModelLimitsToCaps({}, { id: "unknown" })).toEqual({});
  });

  it("emits OpenAI-compatible aliases only for known values", () => {
    expect(modelLimitsForOpenAI({ caps: { contextWindow: 32000 } })).toEqual({
      context_length: 32000,
      max_input_tokens: 32000,
    });
    expect(modelLimitsForOpenAI({ id: "unknown" })).toEqual({});
  });
});
