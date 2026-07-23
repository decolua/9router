import { describe, expect, it } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";

describe("injectSystemPrompt Responses input", () => {
  it("does not mutate additional_tools items", () => {
    const additionalTools = {
      type: "additional_tools",
      role: "developer",
      tools: [{ type: "custom", name: "exec" }]
    };
    const body = {
      input: [additionalTools, {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello" }]
      }]
    };

    injectSystemPrompt(body, "openai-responses", "Be concise");

    expect(body.instructions).toBe("Be concise");
    expect(body.input[0]).toBe(additionalTools);
    expect(additionalTools).not.toHaveProperty("content");
  });
});
