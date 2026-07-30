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
    connectionId: "test-codex-function-call-item-id",
    providerSpecificData: {},
  });

  return body.input;
}

describe("CodexExecutor function-call item ids", () => {
  it("strips replayed item ids without changing the tool correlation id", () => {
    const input = transformInput([
      {
        type: "function_call",
        id: "item_a80a215e158de93e3e66cd2c",
        call_id: "call_shell_1",
        name: "shell",
        arguments: "{}",
      },
      {
        type: "function_call_output",
        id: "item_output_1",
        call_id: "call_shell_1",
        output: "done",
      },
    ]);

    expect(input[0]).toEqual({
      type: "function_call",
      call_id: "call_shell_1",
      name: "shell",
      arguments: "{}",
    });
    expect(input[1].id).toBe("item_output_1");
    expect(input[1].call_id).toBe("call_shell_1");
  });

  it("cleans an invalid function-call id at the reported history index", () => {
    const history = Array.from({ length: 59 }, (_, index) => ({
      type: "message",
      id: `item_message_${index}`,
      role: "user",
      content: [{ type: "input_text", text: `step ${index}` }],
    }));
    history.push({
      type: "function_call",
      id: "item_6a5f72cd0d444378d96b2841",
      call_id: "call_reported_59",
      name: "local_tool",
      arguments: "{}",
    });

    const input = transformInput(history);

    expect(input[59].id).toBeUndefined();
    expect(input[59].call_id).toBe("call_reported_59");
  });

  it("removes every function-call item id when store is disabled", () => {
    const input = transformInput([
      {
        type: "function_call",
        id: "fc_valid_1",
        call_id: "call_valid_1",
        name: "shell",
        arguments: "{}",
      },
      {
        type: "function_call",
        id: 42,
        call_id: "call_numeric_1",
        name: "shell",
        arguments: "{}",
      },
    ]);

    expect(input[0].id).toBeUndefined();
    expect(input[0].call_id).toBe("call_valid_1");
    expect(input[1].id).toBeUndefined();
    expect(input[1].call_id).toBe("call_numeric_1");
  });

});
