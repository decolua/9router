import { describe, it, expect } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { hasValuableContent } from "../../open-sse/utils/streamHelpers.js";

describe("hasValuableContent (OpenAI format)", () => {
  it("keeps chunks carrying delta.reasoning (ollama.com/v1 style)", () => {
    const chunk = {
      choices: [{ index: 0, delta: { reasoning: "thinking text" }, finish_reason: null }],
    };
    expect(hasValuableContent(chunk, FORMATS.OPENAI)).toBe(true);
  });

  it("keeps chunks carrying delta.reasoning_content (OpenAI style)", () => {
    const chunk = {
      choices: [{ index: 0, delta: { reasoning_content: "thinking text" }, finish_reason: null }],
    };
    expect(hasValuableContent(chunk, FORMATS.OPENAI)).toBe(true);
  });

  it("drops empty chunks", () => {
    const chunk = {
      choices: [{ index: 0, delta: {}, finish_reason: null }],
    };
    expect(hasValuableContent(chunk, FORMATS.OPENAI)).toBeFalsy();
  });
});
