import { describe, expect, it } from "vitest";

import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";

describe("system prompt injection", () => {
  it("keeps Responses Lite additional_tools schema intact", () => {
    const body = {
      input: [
        { type: "additional_tools", role: "developer", tools: [] },
        { type: "message", role: "developer", content: [{ type: "input_text", text: "base" }] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
    };

    injectSystemPrompt(body, "openai-responses", "injected");

    expect(body.input[0]).toEqual({ type: "additional_tools", role: "developer", tools: [] });
    expect(body.input[1].content).toEqual([
      { type: "input_text", text: "base" },
      { type: "input_text", text: "injected" },
    ]);
  });

  it("inserts a Lite developer message after additional_tools when missing", () => {
    const body = {
      input: [
        { type: "additional_tools", role: "developer", tools: [] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
      ],
    };

    injectSystemPrompt(body, "openai-responses", "injected");

    expect(body.input).toEqual([
      { type: "additional_tools", role: "developer", tools: [] },
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "injected" }],
      },
      { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
    ]);
  });
});
