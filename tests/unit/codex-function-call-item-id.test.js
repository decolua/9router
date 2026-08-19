import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";

function transformInput(input) {
  const executor = new CodexExecutor();
  const body = {
    model: "gpt-5.6-sol",
    input,
    stream: true,
  };

  executor.transformRequest("gpt-5.6-sol", body, true, {
    connectionId: "test-codex-stateless-item-id",
    providerSpecificData: {},
  });

  return body.input;
}

describe("CodexExecutor stateless call item IDs", () => {
  it("removes arbitrary call item IDs while preserving call_id pairs and payloads", () => {
    const input = transformInput([
      {
        type: "function_call",
        id: "item_replayed_function",
        call_id: "call_function",
        name: "shell",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        id: "arbitrary-output-id",
        call_id: "call_function",
        output: "done",
      },
      {
        type: "custom_tool_call",
        id: 42,
        call_id: "call_custom",
        name: "codex_app",
        input: "PAYLOAD",
      },
      {
        type: "custom_tool_call_output",
        id: null,
        call_id: "call_custom",
        output: "RESULT",
      },
      {
        type: "message",
        id: "item_message_kept",
        role: "user",
        content: "continue",
      },
    ]);

    expect(input).toEqual([
      {
        type: "function_call",
        call_id: "call_function",
        name: "shell",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        call_id: "call_function",
        output: "done",
      },
      {
        type: "custom_tool_call",
        call_id: "call_custom",
        name: "codex_app",
        input: "PAYLOAD",
      },
      {
        type: "custom_tool_call_output",
        call_id: "call_custom",
        output: "RESULT",
      },
      {
        type: "message",
        id: "item_message_kept",
        role: "user",
        content: "continue",
      },
    ]);
  });
});
