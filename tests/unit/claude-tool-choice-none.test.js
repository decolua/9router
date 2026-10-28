import { describe, expect, it } from "vitest";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

describe("Claude to OpenAI tool choice", () => {
  it("preserves the caller's do-not-call-tools restriction", () => {
    const translated = claudeToOpenAIRequest("gpt-5.5", {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "probe", input_schema: { type: "object", properties: {} } }],
      tool_choice: { type: "none" },
    }, false);
    expect(translated.tool_choice).toBe("none");
  });
});
