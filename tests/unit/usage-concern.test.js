// A3: locks toOpenAIUsage per-provider token math (claude/gemini/kiro/ollama/commandcode).
import { describe, it, expect } from "vitest";
import { toOpenAIUsage } from "../../open-sse/translator/concerns/usage.js";

describe("toOpenAIUsage", () => {
  it("claude: folds cache read+create into prompt, exposes details", () => {
    const u = toOpenAIUsage(
      { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 10 },
      "claude"
    );
    expect(u.prompt_tokens).toBe(140);
    expect(u.completion_tokens).toBe(20);
    expect(u.total_tokens).toBe(160);
    expect(u.prompt_tokens_details.cached_tokens).toBe(30);
    expect(u.prompt_tokens_details.cache_creation_tokens).toBe(10);
  });

  it("claude: no cache -> no prompt_tokens_details", () => {
    const u = toOpenAIUsage({ input_tokens: 50, output_tokens: 5 }, "claude");
    expect(u.prompt_tokens).toBe(50);
    expect(u.prompt_tokens_details).toBeUndefined();
  });

  it("gemini: full fields, completion = candidates + thoughts", () => {
    const u = toOpenAIUsage(
      { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 10, totalTokenCount: 150 },
      "gemini"
    );
    expect(u.prompt_tokens).toBe(100);
    expect(u.completion_tokens).toBe(50);
    expect(u.total_tokens).toBe(150);
    expect(u.completion_tokens_details.reasoning_tokens).toBe(10);
  });

  it("gemini fallback: candidates=0 -> derive from total - prompt - thoughts", () => {
    const u = toOpenAIUsage(
      { promptTokenCount: 100, candidatesTokenCount: 0, thoughtsTokenCount: 10, totalTokenCount: 150 },
      "gemini"
    );
    // candidates derived = 150 - 100 - 10 = 40 ; completion = 40 + 10
    expect(u.completion_tokens).toBe(50);
  });

  it("kiro: input/output straight", () => {
    const u = toOpenAIUsage({ inputTokens: 12, outputTokens: 3 }, "kiro");
    expect(u.prompt_tokens).toBe(12);
    expect(u.completion_tokens).toBe(3);
    expect(u.total_tokens).toBe(15);
  });

  it("ollama: prompt_eval_count/eval_count", () => {
    const u = toOpenAIUsage({ prompt_eval_count: 7, eval_count: 4 }, "ollama");
    expect(u.prompt_tokens).toBe(7);
    expect(u.completion_tokens).toBe(4);
    expect(u.total_tokens).toBe(11);
  });

  it("commandcode: keeps totalTokens fallback", () => {
    const u = toOpenAIUsage({ inputTokens: 8, outputTokens: 2, totalTokens: 99 }, "commandcode");
    expect(u.prompt_tokens).toBe(8);
    expect(u.completion_tokens).toBe(2);
    expect(u.total_tokens).toBe(99);
  });

  it("unknown kind / null raw -> null", () => {
    expect(toOpenAIUsage({}, "nope")).toBeNull();
    expect(toOpenAIUsage(null, "claude")).toBeNull();
  });
});
