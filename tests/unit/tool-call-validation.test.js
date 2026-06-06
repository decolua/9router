import { describe, it, expect } from "vitest";

import {
  validateToolCallArguments,
  validateChatCompletionToolCalls,
} from "../../open-sse/utils/toolCallValidation.js";

describe("tool-call argument validation", () => {
  it("accepts valid JSON string arguments", () => {
    const result = validateToolCallArguments({
      type: "function",
      function: { name: "write_file", arguments: JSON.stringify({ path: "/tmp/a", content: "ok" }) },
    });

    expect(result.ok).toBe(true);
  });

  it("rejects truncated JSON string arguments", () => {
    const result = validateToolCallArguments({
      type: "function",
      function: { name: "write_file", arguments: '{"content":' },
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("malformed tool arguments for write_file");
  });

  it("validates all choices in chat completion responses", () => {
    const response = {
      choices: [{
        message: {
          tool_calls: [{
            type: "function",
            function: { name: "execute_code", arguments: "{\"code" },
          }],
        },
      }],
    };

    const result = validateChatCompletionToolCalls(response);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("execute_code");
  });

  it("ignores responses without tool calls", () => {
    expect(validateChatCompletionToolCalls({ choices: [{ message: { content: "ok" } }] }).ok).toBe(true);
  });
});
