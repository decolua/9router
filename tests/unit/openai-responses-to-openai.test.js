import { describe, it, expect } from "vitest";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";

describe("openai-responses-to-openai — reasoning summary", () => {
  it("maps Responses API reasoning summary deltas to OpenAI reasoning_content", () => {
    const state = {};

    const chunk = openaiResponsesToOpenAIResponse(
      {
        type: "response.reasoning_summary_text.delta",
        delta: "thinking...",
      },
      state,
    );

    expect(chunk.choices[0].delta.reasoning_content).toBe("thinking...");
    expect(chunk.choices[0].delta.content).toBeUndefined();
    expect(chunk.choices[0].finish_reason).toBeNull();
  });
});
