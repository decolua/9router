import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";

function transform(input) {
  const executor = new CodexExecutor();
  const body = {
    model: "gpt-5.6-sol",
    input,
    stream: true,
    tools: [{
      type: "function",
      function: { name: "read_file", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
    }],
  };
  executor.transformRequest("gpt-5.6-sol", body, true, {
    connectionId: "test-orphaned-outputs",
    providerSpecificData: {},
  });
  return body.input;
}

describe("CodexExecutor stripOrphanedToolOutputs", () => {
  it("removes function_call_output with no matching function_call", () => {
    const input = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "function_call_output", call_id: "call_orphan1", output: "result1" },
      { type: "function_call_output", call_id: "call_orphan2", output: "result2" },
    ];
    const result = transform(input);
    const outputs = result.filter((i) => i.type === "function_call_output");
    expect(outputs).toEqual([]);
  });

  it("keeps function_call_output when matching function_call exists", () => {
    const input = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "function_call", call_id: "call_valid", name: "read_file", arguments: '{"path":"a.txt"}' },
      { type: "function_call_output", call_id: "call_valid", output: "file contents" },
    ];
    const result = transform(input);
    const outputs = result.filter((i) => i.type === "function_call_output");
    expect(outputs).toHaveLength(1);
    expect(outputs[0].call_id).toBe("call_valid");
  });

  it("keeps matched, removes orphaned in mixed input", () => {
    const input = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "function_call", call_id: "call_keep", name: "read_file", arguments: "{}" },
      { type: "function_call_output", call_id: "call_keep", output: "ok" },
      { type: "function_call_output", call_id: "call_orphan", output: "orphaned" },
    ];
    const result = transform(input);
    const outputs = result.filter((i) => i.type === "function_call_output");
    expect(outputs).toHaveLength(1);
    expect(outputs[0].call_id).toBe("call_keep");
  });

  it("handles Chat Completions tool_calls format in assistant message", () => {
    const input = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { role: "assistant", content: null, tool_calls: [{ id: "call_cc1", function: { name: "read_file", arguments: "{}" } }] },
      { type: "function_call_output", call_id: "call_cc1", output: "ok" },
      { type: "function_call_output", call_id: "call_cc2", output: "orphaned" },
    ];
    const result = transform(input);
    const outputs = result.filter((i) => i.type === "function_call_output");
    expect(outputs).toHaveLength(1);
    expect(outputs[0].call_id).toBe("call_cc1");
  });

  it("no-op when no function_call_output items", () => {
    const input = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      { type: "function_call", call_id: "call_1", name: "read_file", arguments: "{}" },
    ];
    const result = transform(input);
    expect(result).toHaveLength(2);
  });
});
