import { describe, expect, it } from "vitest";

import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";

describe("reasoning content injector", () => {
  it("echoes placeholder reasoning_content for Xiaomi thinking models with tool calls", () => {
    const body = {
      model: "mimo-v2.5-pro",
      messages: [
        { role: "user", content: "call a tool" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "read_file", arguments: "{}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call-1", content: "ok" },
      ],
    };

    const result = injectReasoningContent({
      provider: "xiaomi-tokenplan",
      model: "mimo-v2.5-pro",
      body,
    });

    expect(result.messages[1].reasoning_content).toBe(" ");
    expect(body.messages[1]).not.toHaveProperty("reasoning_content");
  });

  it("echoes placeholder reasoning_content for Xiaomi plain assistant messages", () => {
    const body = {
      model: "mimo-v2.5-pro",
      messages: [
        { role: "assistant", content: "plain text" },
      ],
    };

    const result = injectReasoningContent({
      provider: "xiaomi-tokenplan",
      model: "mimo-v2.5-pro",
      body,
    });

    expect(result.messages[0].reasoning_content).toBe(" ");
  });

  it("preserves existing reasoning_content values", () => {
    const body = {
      model: "mimo-v2.5-pro",
      messages: [
        {
          role: "assistant",
          content: "",
          reasoning_content: "actual reasoning",
          tool_calls: [{ id: "call-1", type: "function", function: { name: "x", arguments: "{}" } }],
        },
      ],
    };

    const result = injectReasoningContent({
      provider: "xiaomi-tokenplan",
      model: "mimo-v2.5-pro",
      body,
    });

    expect(result.messages[0].reasoning_content).toBe("actual reasoning");
  });
});
