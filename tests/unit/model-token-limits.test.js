import { describe, expect, it } from "vitest";
import {
  normalizeModelTokenLimits,
  withModelTokenLimits,
} from "../../src/shared/utils/modelTokenLimits.js";

describe("model token limit metadata", () => {
  it("normalizes OpenAI-style custom model limits", () => {
    expect(normalizeModelTokenLimits({
      max_input_tokens: 131072,
      max_output_tokens: "8192",
    })).toEqual({
      max_input_tokens: 131072,
      context_length: 131072,
      max_output_tokens: 8192,
    });
  });

  it("accepts existing context window aliases", () => {
    expect(normalizeModelTokenLimits({ contextWindow: 200000 })).toEqual({
      max_input_tokens: 200000,
      context_length: 200000,
    });
  });

  it("does not emit invalid limits", () => {
    expect(normalizeModelTokenLimits({
      max_input_tokens: 0,
      max_output_tokens: -1,
      context_length: "nope",
    })).toEqual({});
  });

  it("adds known limits to OpenAI model list entries", () => {
    expect(withModelTokenLimits(
      { id: "custom/model", object: "model", owned_by: "custom" },
      { max_input_tokens: 1000, max_output_tokens: 250 },
    )).toEqual({
      id: "custom/model",
      object: "model",
      owned_by: "custom",
      max_input_tokens: 1000,
      context_length: 1000,
      max_output_tokens: 250,
    });
  });
});
