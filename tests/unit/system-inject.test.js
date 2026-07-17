import { describe, expect, it } from "vitest";

import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("Responses system prompt injection", () => {
  it("skips Codex additional_tools items and appends to a real developer message", () => {
    const additionalTools = {
      type: "additional_tools",
      role: "developer",
      tools: [{ type: "function", name: "exec" }],
    };
    const body = {
      input: [
        additionalTools,
        {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "existing" }],
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      ],
    };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "injected");

    expect(body.input[0]).toEqual(additionalTools);
    expect(body.input[0]).not.toHaveProperty("content");
    expect(body.input[1].content).toEqual([
      { type: "input_text", text: "existing" },
      { type: "input_text", text: "injected" },
    ]);
  });

  it("creates a typed developer message when Responses input has no instruction message", () => {
    const additionalTools = {
      type: "additional_tools",
      role: "developer",
      tools: [{ type: "function", name: "exec" }],
    };
    const body = { input: [additionalTools] };

    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "injected");

    expect(body.input).toEqual([
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "injected" }],
      },
      additionalTools,
    ]);
    expect(additionalTools).not.toHaveProperty("content");
  });
});
