import { describe, expect, it } from "vitest";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("extractUsageFromResponse", () => {
  it("extracts raw Ollama usage from non-streaming responses", () => {
    const usage = extractUsageFromResponse(
      { done: true, prompt_eval_count: 18, eval_count: 3 },
      { targetFormat: FORMATS.OLLAMA, requestBody: { messages: [{ role: "user", content: "hello" }] } }
    );

    expect(usage).toMatchObject({
      prompt_tokens: 18,
      completion_tokens: 3,
      total_tokens: 21
    });
    expect(usage.estimated).toBeUndefined();
  });

  it("estimates missing Ollama prompt tokens when output tokens are present", () => {
    const usage = extractUsageFromResponse(
      { done: true, eval_count: 1 },
      { targetFormat: FORMATS.OLLAMA, requestBody: { messages: [{ role: "user", content: "hello world" }] } }
    );

    expect(usage.prompt_tokens).toBeGreaterThan(0);
    expect(usage.completion_tokens).toBe(1);
    expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens);
    expect(usage.estimated).toBe(true);
  });

  it("extracts nested OpenAI Responses API usage", () => {
    const usage = extractUsageFromResponse({
      response: {
        usage: {
          input_tokens: 10,
          output_tokens: 4,
          input_tokens_details: { cached_tokens: 2 },
          output_tokens_details: { reasoning_tokens: 1 }
        }
      }
    });

    expect(usage).toMatchObject({
      prompt_tokens: 10,
      completion_tokens: 4,
      cached_tokens: 2,
      reasoning_tokens: 1
    });
  });

  it("extracts nested Gemini usage metadata", () => {
    const usage = extractUsageFromResponse({
      response: {
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 2,
          thoughtsTokenCount: 1,
          totalTokenCount: 8
        }
      }
    });

    expect(usage).toMatchObject({
      prompt_tokens: 5,
      completion_tokens: 2,
      reasoning_tokens: 1,
      total_tokens: 8
    });
  });

  it("extracts Kiro and CommandCode raw non-stream usage fields", () => {
    expect(extractUsageFromResponse({ inputTokens: 12, outputTokens: 3 }, { targetFormat: FORMATS.KIRO })).toMatchObject({
      prompt_tokens: 12,
      completion_tokens: 3,
      total_tokens: 15
    });

    expect(extractUsageFromResponse({ inputTokens: 8, outputTokens: 2, totalTokens: 20 }, { targetFormat: FORMATS.COMMANDCODE })).toMatchObject({
      prompt_tokens: 8,
      completion_tokens: 2,
      total_tokens: 20
    });
  });
});
