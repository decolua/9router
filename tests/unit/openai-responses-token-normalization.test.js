import { describe, expect, it } from "vitest";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

const baseBody = {
  messages: [{ role: "user", content: "hello" }]
};

describe("openaiToOpenAIResponsesRequest token limit normalization", () => {
  it("prefers max_output_tokens when token limit fields are present", () => {
    const result = openaiToOpenAIResponsesRequest("gpt-5", {
      ...baseBody,
      max_tokens: 5,
      max_completion_tokens: 11,
      max_output_tokens: 17
    }, false);

    expect(result.max_output_tokens).toBe(17);
    expect(result.max_completion_tokens).toBeUndefined();
    expect(result.max_tokens).toBeUndefined();
  });

  it("maps max_completion_tokens to max_output_tokens before max_tokens", () => {
    const result = openaiToOpenAIResponsesRequest("gpt-5", {
      ...baseBody,
      max_tokens: 5,
      max_completion_tokens: 11
    }, false);

    expect(result.max_output_tokens).toBe(11);
    expect(result.max_completion_tokens).toBeUndefined();
    expect(result.max_tokens).toBeUndefined();
  });

  it("maps max_tokens to max_output_tokens when other token limits are absent", () => {
    const result = openaiToOpenAIResponsesRequest("gpt-5", {
      ...baseBody,
      max_tokens: 5
    }, false);

    expect(result.max_output_tokens).toBe(5);
    expect(result.max_completion_tokens).toBeUndefined();
    expect(result.max_tokens).toBeUndefined();
  });
});
